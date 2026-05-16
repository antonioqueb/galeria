# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta

from odoo import models, fields, api, _
from odoo.exceptions import UserError
from odoo.http import request

import logging

_logger = logging.getLogger(__name__)


class GalleryShare(models.Model):
    _name = 'gallery.share'
    _description = 'Catálogo Compartido'
    _inherit = ['mail.thread', 'mail.activity.mixin']

    name = fields.Char(
        string="Referencia",
        required=True,
        copy=False,
        readonly=True,
        default=lambda self: ('Nuevo')
    )
    partner_id = fields.Many2one(
        'res.partner',
        string="Cliente",
        required=True,
        tracking=True
    )
    user_id = fields.Many2one(
        'res.users',
        string="Vendedor",
        default=lambda self: self.env.user,
        readonly=True
    )

    company_id = fields.Many2one(
        'res.company',
        string="Compañía",
        required=True,
        default=lambda self: self.env.company,
        readonly=True
    )

    access_token = fields.Char(
        string="Token de Acceso",
        required=True,
        default=lambda self: str(uuid.uuid4()),
        readonly=True
    )
    create_date = fields.Datetime(
        string="Fecha Creación",
        default=fields.Datetime.now
    )
    expiration_date = fields.Datetime(
        string="Expira el",
        required=True
    )
    is_expired = fields.Boolean(
        string="Expirado",
        compute='_compute_is_expired'
    )
    image_ids = fields.Many2many(
        'stock.lot.image',
        string="Imágenes Seleccionadas"
    )
    share_url = fields.Char(
        string="URL Compartida",
        compute='_compute_share_url'
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'Nuevo') == 'Nuevo':
                vals['name'] = self.env['ir.sequence'].next_by_code('gallery.share') or 'CAT/0000'

            if not vals.get('expiration_date'):
                vals['expiration_date'] = fields.Datetime.now() + timedelta(days=3)

            if not vals.get('company_id'):
                vals['company_id'] = self.env.company.id

        return super(GalleryShare, self).create(vals_list)

    @api.depends('expiration_date')
    def _compute_is_expired(self):
        now = fields.Datetime.now()
        for record in self:
            record.is_expired = record.expiration_date < now if record.expiration_date else False

    @api.depends('access_token')
    def _compute_share_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for record in self:
            record.share_url = f"{base_url}/gallery/view/{record.access_token}"

    def action_regenerate_token(self):
        self.access_token = str(uuid.uuid4())

    def action_send_email(self):
        self.ensure_one()
        template = self.env.ref('galeria.email_template_gallery_share', raise_if_not_found=False)
        compose_form = self.env.ref('mail.email_compose_message_wizard_form')
        ctx = dict(
            default_model='gallery.share',
            default_res_ids=[self.id],
            default_template_id=template.id if template else False,
            default_composition_mode='comment',
            default_email_layout_xmlid="mail.mail_notification_light",
        )
        return {
            'name': 'Enviar Catálogo',
            'type': 'ir.actions.act_window',
            'view_mode': 'form',
            'res_model': 'mail.compose.message',
            'views': [(compose_form.id, 'form')],
            'view_id': compose_form.id,
            'target': 'new',
            'context': ctx,
        }

    @api.model
    def create_from_selector(self, partner_id, image_ids):
        share = self.create([{
            'partner_id': partner_id,
            'image_ids': [(6, 0, image_ids)],
            'company_id': self.env.company.id,
        }])
        return {
            'id': share.id,
            'name': share.name,
            'url': share.share_url,
        }

    @api.model
    def get_current_company(self):
        return self.env.company.id

    def _get_public_hold_price(self, product):
        """
        Precio usado para reservas públicas creadas desde galería.

        Se mantiene la misma lógica anterior:
        1. Usa x_price_usd_1 si existe y tiene valor.
        2. Si no existe o es 0, usa list_price.
        """
        self.ensure_one()

        price_unit = 0.0
        tmpl = product.product_tmpl_id

        if 'x_price_usd_1' in tmpl._fields:
            price_unit = tmpl.x_price_usd_1 or 0.0

        if price_unit <= 0:
            price_unit = product.list_price or 0.0

        return price_unit

    def create_public_hold_order(self, items):
        """
        Crea una orden de reserva basada en la selección del cliente externo.

        Corrección importante:
        - Antes se creaba una línea de apartado por cada lote seleccionado.
        - Ahora se agrupan los lotes por producto.
        - Resultado esperado:
            Producto A
                lot_ids = [lote 1, lote 2, lote 3]
                cantidad_m2 = suma de m² de los lotes
        """
        self.ensure_one()

        HoldOrder = self.env['stock.lot.hold.order'].with_company(self.company_id).sudo()
        Quant = self.env['stock.quant'].with_company(self.company_id).sudo()

        usd_currency = self.env['res.currency'].sudo().search([('name', '=', 'USD')], limit=1)
        if not usd_currency:
            usd_currency = self.company_id.currency_id

        grouped_lines = {}
        processed_lot_ids = set()

        for item in items:
            raw_lot_id = item.get('lot_id')
            raw_quant_id = item.get('quant_id')

            try:
                lot_id = int(raw_lot_id) if raw_lot_id else False
            except Exception:
                lot_id = False

            try:
                quant_id = int(raw_quant_id) if raw_quant_id else False
            except Exception:
                quant_id = False

            quant = Quant.browse()

            # 1) Prioridad: usar el quant exacto enviado por la galería.
            if quant_id:
                candidate = Quant.browse(quant_id).exists()

                if candidate:
                    same_company = candidate.company_id.id == self.company_id.id
                    is_internal = candidate.location_id.usage == 'internal'
                    has_stock = candidate.quantity > 0
                    same_lot = not lot_id or candidate.lot_id.id == lot_id

                    if same_company and is_internal and has_stock and same_lot:
                        quant = candidate
                        lot_id = candidate.lot_id.id

            # 2) Fallback: si no hay quant válido, buscar por lote.
            if not quant and lot_id:
                quant = Quant.search([
                    ('lot_id', '=', lot_id),
                    ('company_id', '=', self.company_id.id),
                    ('location_id.usage', '=', 'internal'),
                    ('quantity', '>', 0),
                ], limit=1)

            if not quant or not quant.lot_id:
                continue

            # Evita duplicar el mismo lote si por alguna razón llegó dos veces desde el carrito.
            if quant.lot_id.id in processed_lot_ids:
                continue

            if quant.reserved_quantity > 0 or quant.x_tiene_hold:
                raise UserError(
                    f"El lote {quant.lot_id.name} ya no está disponible. "
                    f"Fue reservado por otro cliente."
                )

            product = quant.product_id
            if not product:
                continue

            processed_lot_ids.add(quant.lot_id.id)

            product_key = product.id
            price_unit = self._get_public_hold_price(product)

            if product_key not in grouped_lines:
                grouped_lines[product_key] = {
                    'product': product,
                    'price_unit': price_unit,
                    'quant_ids': [],
                    'lot_ids': [],
                    'cantidad_m2': 0.0,
                    'lot_names': [],
                }

            grouped_lines[product_key]['quant_ids'].append(quant.id)
            grouped_lines[product_key]['lot_ids'].append(quant.lot_id.id)
            grouped_lines[product_key]['lot_names'].append(quant.lot_id.name)
            grouped_lines[product_key]['cantidad_m2'] += quant.quantity or 0.0

        if not grouped_lines:
            raise UserError(
                "No se pudieron procesar los items seleccionados. "
                "Es posible que ya no estén disponibles."
            )

        hold_lines = []

        for group in grouped_lines.values():
            product = group['product']
            lot_ids = group['lot_ids']
            quant_ids = group['quant_ids']

            if not lot_ids:
                continue

            hold_lines.append((0, 0, {
                # Campos legacy/de compatibilidad.
                # Se usa el primer quant/lote únicamente como referencia principal.
                'quant_id': quant_ids[0],
                'lot_id': lot_ids[0],

                # Campo real para manejar múltiples placas dentro de la misma línea.
                'lot_ids': [(6, 0, lot_ids)],

                'product_id': product.id,
                'cantidad_m2': group['cantidad_m2'],
                'precio_unitario': group['price_unit'],
            }))

        if not hold_lines:
            raise UserError(
                "No se pudieron generar líneas de reserva para los materiales seleccionados."
            )

        try:
            order = HoldOrder.create({
                'partner_id': self.partner_id.id,
                'user_id': self.user_id.id,
                'company_id': self.company_id.id,
                'currency_id': usd_currency.id,
                'fecha_orden': fields.Datetime.now(),
                'notas': f"Reserva creada automáticamente desde Galería Pública ({self.name}).",
                'hold_line_ids': hold_lines,
            })

            order.action_confirm()

            _logger.info(
                "[Gallery] Reserva pública creada agrupando por producto | Share=%s | Orden=%s | Líneas=%s | Lotes=%s",
                self.name,
                order.name,
                len(hold_lines),
                len(processed_lot_ids),
            )

            return {
                'success': True,
                'order_name': order.name,
                'message': 'Reserva confirmada exitosamente.',
            }

        except Exception as e:
            _logger.error(f"Error creando reserva pública: {str(e)}")
            raise UserError(f"Error al procesar la reserva: {str(e)}")