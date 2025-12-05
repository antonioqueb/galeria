# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api, _
from odoo.exceptions import UserError
from odoo.http import request

class GalleryShare(models.Model):
    _name = 'gallery.share'
    _description = 'Catálogo Compartido'
    _inherit = ['mail.thread', 'mail.activity.mixin']

    name = fields.Char(string="Referencia", required=True, copy=False, readonly=True, default=lambda self: ('Nuevo'))
    partner_id = fields.Many2one('res.partner', string="Cliente", required=True, tracking=True)
    user_id = fields.Many2one('res.users', string="Vendedor", default=lambda self: self.env.user, readonly=True)
    
    # ✅ NUEVO: Vinculación estricta con la empresa
    company_id = fields.Many2one(
        'res.company', 
        string="Compañía", 
        required=True, 
        default=lambda self: self.env.company, 
        readonly=True
    )
    
    access_token = fields.Char(string="Token de Acceso", required=True, default=lambda self: str(uuid.uuid4()), readonly=True)
    create_date = fields.Datetime(string="Fecha Creación", default=fields.Datetime.now)
    expiration_date = fields.Datetime(string="Expira el", required=True)
    is_expired = fields.Boolean(string="Expirado", compute='_compute_is_expired')
    image_ids = fields.Many2many('stock.lot.image', string="Imágenes Seleccionadas")
    share_url = fields.Char(string="URL Compartida", compute='_compute_share_url')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'Nuevo') == 'Nuevo':
                vals['name'] = self.env['ir.sequence'].next_by_code('gallery.share') or 'CAT/0000'
            
            if not vals.get('expiration_date'):
                vals['expiration_date'] = fields.Datetime.now() + timedelta(days=3)
            
            # Asegurar que se guarde con la compañía actual si no viene
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
        # ✅ Al crear desde el selector, usamos explícitamente la compañía del usuario actual
        share = self.create([{
            'partner_id': partner_id,
            'image_ids': [(6, 0, image_ids)],
            'company_id': self.env.company.id
        }])
        return {
            'id': share.id,
            'name': share.name,
            'url': share.share_url
        }

    def create_public_hold_order(self, items):
        """
        Crea una orden de reserva basada en la selección del cliente externo.
        """
        self.ensure_one()
        
        # ✅ Forzamos el entorno a la compañía que generó el Link
        # Esto es crucial para que el 'search' de quants encuentre los de la empresa correcta
        HoldOrder = self.env['stock.lot.hold.order'].with_company(self.company_id).sudo()
        Quant = self.env['stock.quant'].with_company(self.company_id).sudo()
        
        usd_currency = self.env['res.currency'].sudo().search([('name', '=', 'USD')], limit=1)
        if not usd_currency:
            usd_currency = self.company_id.currency_id

        hold_lines = []

        for item in items:
            # ✅ Validamos ID del quant o buscamos por Lote + Compañía
            # El frontend manda 'quant_id', pero validamos que pertenezca a la empresa del share
            # para evitar apartar quants fantasmas de otras empresas.
            
            lot_id = int(item.get('lot_id')) # Asumimos que JS manda lot_id también, si no, sacarlo del quant
            if not lot_id and item.get('quant_id'):
                 original_quant = Quant.browse(int(item.get('quant_id')))
                 lot_id = original_quant.lot_id.id

            # Búsqueda estricta en la compañía del share
            quant = Quant.search([
                ('lot_id', '=', lot_id),
                ('company_id', '=', self.company_id.id), # 🔒 FILTRO CLAVE
                ('location_id.usage', '=', 'internal'),
                ('quantity', '>', 0)
            ], limit=1)
            
            if not quant:
                # Si no existe quant disponible en ESTA empresa, error o saltar
                raise UserError(f"El material {item.get('name')} ya no está disponible en este almacén.")
            
            # Validación estricta de disponibilidad
            if quant.reserved_quantity > 0 or quant.x_tiene_hold:
                raise UserError(f"El lote {quant.lot_id.name} ya no está disponible. Fue reservado por otro cliente recientemente.")

            product = quant.product_id
            
            price_unit = 0.0
            if hasattr(product.product_tmpl_id, 'x_price_usd_1'):
                price_unit = product.product_tmpl_id.x_price_usd_1
            
            if price_unit <= 0:
                price_unit = product.list_price 

            hold_lines.append((0, 0, {
                'quant_id': quant.id,
                'lot_id': quant.lot_id.id,
                'product_id': product.id,
                'cantidad_m2': quant.quantity,
                'precio_unitario': price_unit,
            }))

        if not hold_lines:
            raise UserError("No se pudieron procesar los items seleccionados.")

        try:
            # Crear la Orden de Reserva vinculada a la empresa correcta
            order = HoldOrder.create({
                'partner_id': self.partner_id.id,
                'user_id': self.user_id.id,
                'company_id': self.company_id.id, # 🔒 EMPRESA DEL SHARE
                'currency_id': usd_currency.id,
                'fecha_orden': fields.Datetime.now(),
                'notas': f"Reserva creada automáticamente desde Galería Pública ({self.name}).",
                'hold_line_ids': hold_lines
            })

            order.action_confirm()

            return {
                'success': True, 
                'order_name': order.name,
                'message': 'Reserva confirmada exitosamente.'
            }

        except Exception as e:
            raise UserError(f"Error al procesar la reserva: {str(e)}")