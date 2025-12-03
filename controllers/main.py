# -*- coding: utf-8 -*-
import base64
import json
from odoo import http
from odoo.http import request
from collections import defaultdict

class GalleryController(http.Controller):

    @http.route('/gallery/view/<string:token>', type='http', auth='public', csrf=False)
    def view_gallery(self, token, **kwargs):
        # 1. Buscar el share
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share:
            return request.render('galeria.gallery_not_found', {})
        
        if share.is_expired:
            return request.render('galeria.gallery_expired', {'share': share})

        grouped_images = defaultdict(list)
        
        # 2. Iterar imágenes y validar disponibilidad REAL
        for image in share.image_ids:
            lot = image.lot_id
            
            # Buscar el Quant disponible:
            # - Ubicación Interna
            # - Stock físico > 0
            # - Sin reserva de sistema (reserved_quantity = 0)
            # - Sin Hold manual (x_tiene_hold = False)
            quant = request.env['stock.quant'].sudo().search([
                ('lot_id', '=', lot.id),
                ('location_id.usage', '=', 'internal'),
                ('quantity', '>', 0),
                ('reserved_quantity', '=', 0),
                ('x_tiene_hold', '=', False)
            ], limit=1)

            # Si no hay stock libre, NO mostrar la imagen en la galería
            if not quant:
                continue

            categ = lot.product_id.categ_id
            categ_name = categ.name if categ else "General"
            
            # Calcular área (usando dimensiones si existen, o cantidad del quant)
            area = 0.0
            if hasattr(lot, 'x_alto') and hasattr(lot, 'x_ancho'):
                area = (lot.x_alto or 0) * (lot.x_ancho or 0)
            
            # Si no hay dimensiones registradas, usamos la cantidad del sistema
            if area <= 0: 
                area = quant.quantity

            # Construir objeto de datos para el Frontend
            img_data = {
                'id': image.id,
                'quant_id': quant.id,      # CRUCIAL para la reserva
                'lot_id': lot.id,
                'name': lot.product_id.name,
                'lot_name': lot.name,
                'dimensions': f"{lot.x_alto:.2f} x {lot.x_ancho:.2f} m" if hasattr(lot, 'x_alto') else "",
                'area': round(area, 2),
                'url': f"/gallery/image/{token}/{image.id}",
                'is_large': image.sequence % 5 == 0  # Patrón visual para el grid
            }
            grouped_images[categ_name].append(img_data)

        values = {
            'share': share,
            'grouped_images': dict(grouped_images),
            'company': share.user_id.company_id or request.env.company,
            'token': token  # Pasamos el token para las llamadas API posteriores
        }
        return request.render('galeria.gallery_public_view', values)

    @http.route('/gallery/image/<string:token>/<int:image_id>', type='http', auth='public')
    def view_gallery_image(self, token, image_id, **kwargs):
        """Sirve la imagen binaria validando el token."""
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share or share.is_expired:
            return request.not_found()

        # Verificar que la imagen pertenece a esta galería
        if image_id not in share.image_ids.ids:
            return request.not_found()

        image = request.env['stock.lot.image'].sudo().browse(image_id)
        if not image.image:
            return request.not_found()

        image_data = base64.b64decode(image.image)
        headers = [
            ('Content-Type', 'image/jpeg'),
            ('Content-Length', len(image_data)),
            ('Cache-Control', 'public, max-age=604800')
        ]
        return request.make_response(image_data, headers)

    @http.route('/gallery/confirm_reservation', type='json', auth='public')
    def confirm_reservation(self, token, items):
        """
        Endpoint JSON-RPC llamado por el carrito JS para confirmar.
        """
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share:
            return {'success': False, 'message': 'Token inválido.'}
        
        if share.is_expired:
            return {'success': False, 'message': 'El catálogo ha expirado.'}

        if not items:
            return {'success': False, 'message': 'El carrito está vacío.'}

        try:
            # Delegar lógica compleja al modelo
            return share.create_public_hold_order(items)
        except Exception as e:
            return {'success': False, 'message': str(e)}