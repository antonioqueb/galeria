# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api
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
    
    # CORRECCIÓN: Quitamos el compute almacenado que dependía de create_date y usamos un default o asignación manual
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
            
            # 2. CORRECCIÓN: Asignar fecha de expiración obligatoria si no viene
            if not vals.get('expiration_date'):
                # Por defecto 3 días a partir de ahora mismo
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
        # El ORM convierte esto a lista automáticamente para create_multi
        share = self.create([{
            'partner_id': partner_id,
            'image_ids': [(6, 0, image_ids)]
        }])
        return {
            'id': share.id,
            'name': share.name,
            'url': share.share_url
        }