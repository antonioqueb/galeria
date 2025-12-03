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
    
    # Token de seguridad para el link
    access_token = fields.Char(string="Token de Acceso", required=True, default=lambda self: str(uuid.uuid4()), readonly=True)
    
    # Configuración de expiración
    create_date = fields.Datetime(string="Fecha Creación", default=fields.Datetime.now)
    
    # Expiración manual o por defecto
    expiration_date = fields.Datetime(string="Expira el", required=True)
    
    is_expired = fields.Boolean(string="Expirado", compute='_compute_is_expired')
    
    # Imágenes seleccionadas
    image_ids = fields.Many2many('stock.lot.image', string="Imágenes Seleccionadas")
    
    # URL computada
    share_url = fields.Char(string="URL Compartida", compute='_compute_share_url')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            # 1. Asignar secuencia
            if vals.get('name', 'Nuevo') == 'Nuevo':
                vals['name'] = self.env['ir.sequence'].next_by_code('gallery.share') or 'CAT/0000'
            
            # 2. Asignar fecha de expiración obligatoria si no viene (3 días por defecto)
            if not vals.get('expiration_date'):
                vals['expiration_date'] = fields.Datetime.now() + timedelta(days=3)
                
        return super(GalleryShare, self).create(vals_list)

    @api.depends('expiration_date')
    def _compute_is_expired(self):
        now = fields.Datetime.now()
        for record in self:
            if record.expiration_date:
                record.is_expired = record.expiration_date < now
            else:
                record.is_expired = False

    @api.depends('access_token')
    def _compute_share_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for record in self:
            record.share_url = f"{base_url}/gallery/view/{record.access_token}"

    def action_regenerate_token(self):
        """Regenerar token si se necesita invalidar el anterior"""
        self.access_token = str(uuid.uuid4())

    def action_send_email(self):
        """Abrir wizard de correo"""
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
        """Método llamado desde el JS para crear el share"""
        share = self.create([{
            'partner_id': partner_id,
            'image_ids': [(6, 0, image_ids)]
        }])
        return {
            'id': share.id,
            'name': share.name,
            'url': share.share_url
        }

    # =========================================================================
    # Lógica de Carrito Público y Reserva
    # =========================================================================

    def create_public_hold_order(self, items):
        """
        Crea una orden de reserva basada en la selección del cliente externo.
        Se ejecuta con sudo() desde el controller, pero usamos self para contexto.
        """
        self.ensure_one()
        
        # Instanciar modelos con permisos de sistema (Sudo)
        HoldOrder = self.env['stock.lot.hold.order'].sudo()
        Quant = self.env['stock.quant'].sudo()
        
        # 1. Buscar moneda USD obligatoria
        usd_currency = self.env['res.currency'].sudo().search([('name', '=', 'USD')], limit=1)
        if not usd_currency:
            # Fallback a la moneda de la compañía del vendedor si no existe USD configurado
            usd_currency = self.user_id.company_id.currency_id

        # 2. Preparar líneas de la orden
        hold_lines = []

        for item in items:
            quant_id = int(item.get('quant_id'))
            quant = Quant.browse(quant_id)
            
            if not quant.exists():
                continue
            
            # Validación estricta de disponibilidad (Stock libre, sin hold, sin reserva de sistema)
            if quant.reserved_quantity > 0 or quant.x_tiene_hold:
                raise UserError(f"El lote {quant.lot_id.name} ya no está disponible. Fue reservado por otro cliente.")

            product = quant.product_id
            
            # 3. Obtener Precio Alto (USD 1)
            # Buscamos x_price_usd_1 en product.template (heredado de inventory_shopping_cart)
            price_unit = 0.0
            if hasattr(product.product_tmpl_id, 'x_price_usd_1'):
                price_unit = product.product_tmpl_id.x_price_usd_1
            
            # Si no hay precio USD configurado, usar precio de lista base
            if price_unit <= 0:
                price_unit = product.list_price 

            hold_lines.append((0, 0, {
                'quant_id': quant.id,
                'lot_id': quant.lot_id.id,
                'product_id': product.id,
                'cantidad_m2': quant.quantity, # Reservar todo el lote (cantidad completa)
                'precio_unitario': price_unit,
                # 'precio_total' se calcula automáticamente por compute en hold.order.line
            }))

        if not hold_lines:
            raise UserError("No se pudieron procesar los items seleccionados o ya no están disponibles.")

        # 4. Crear la Orden de Reserva
        # Usamos el vendedor original del link como responsable
        # Usamos el partner del link como cliente
        try:
            order = HoldOrder.create({
                'partner_id': self.partner_id.id,
                'user_id': self.user_id.id,
                'company_id': self.user_id.company_id.id, # Compañía del vendedor
                'currency_id': usd_currency.id,
                'fecha_orden': fields.Datetime.now(),
                # La fecha de expiración se calcula automáticamente en el create del modelo hold.order (5 días hábiles)
                'notas': f"Reserva creada automáticamente desde Galería Pública ({self.name}).",
                'hold_line_ids': hold_lines
            })

            # 5. Confirmar la orden 
            # Esto dispara la creación de los Holds físicos en stock.quant
            order.action_confirm()

            return {
                'success': True, 
                'order_name': order.name,
                'message': 'Reserva confirmada exitosamente. Su vendedor se pondrá en contacto para finalizar.'
            }

        except Exception as e:
            # Re-lanzar error para que lo capture el controlador y lo muestre al cliente JS
            raise UserError(f"Error al procesar la reserva: {str(e)}")