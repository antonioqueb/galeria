# -*- coding: utf-8 -*-
import base64
import json
from odoo import http
from odoo.http import request
from collections import defaultdict

class GalleryController(http.Controller):

    @http.route('/gallery/view/<string:token>', type='http', auth='public', csrf=False)
    def view_gallery(self, token, **kwargs):
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share:
            return request.render('galeria.gallery_not_found', {})
        
        if share.is_expired:
            return request.render('galeria.gallery_expired', {'share': share})

        grouped_images = defaultdict(list)
        StockQuant = request.env['stock.quant'].sudo().with_company(share.company_id)

        for image in share.image_ids:
            lot = image.lot_id
            
            quant = StockQuant.search([
                ('lot_id', '=', lot.id),
                ('company_id', '=', share.company_id.id),
                ('location_id.usage', '=', 'internal'),
                ('quantity', '>', 0),
                ('reserved_quantity', '=', 0),
                ('x_tiene_hold', '=', False)
            ], limit=1)

            if not quant:
                continue

            categ = lot.product_id.categ_id
            categ_name = categ.name if categ else "General"
            
            area = 0.0
            if hasattr(lot, 'x_alto') and hasattr(lot, 'x_ancho'):
                area = (lot.x_alto or 0) * (lot.x_ancho or 0)
            
            if area <= 0: 
                area = quant.quantity

            img_data = {
                'id': image.id,
                'quant_id': quant.id,
                'lot_id': lot.id,
                'name': lot.product_id.name,
                'lot_name': lot.name,
                'dimensions': f"{lot.x_alto:.2f} x {lot.x_ancho:.2f} m" if hasattr(lot, 'x_alto') else "",
                'area': round(area, 2),
                'url': f"/gallery/image/{token}/{image.id}",
                'is_large': image.sequence % 5 == 0
            }
            grouped_images[categ_name].append(img_data)

        values = {
            'share': share,
            'grouped_images': dict(grouped_images),
            'company': share.company_id,
            'token': token
        }
        return request.render('galeria.gallery_public_view', values)

    @http.route('/gallery/image/<string:token>/<int:image_id>', type='http', auth='public')
    def view_gallery_image(self, token, image_id, **kwargs):
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share or share.is_expired:
            return request.not_found()

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
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share:
            return {'success': False, 'message': 'Token inválido.'}
        
        if share.is_expired:
            return {'success': False, 'message': 'El catálogo ha expirado.'}

        if not items:
            return {'success': False, 'message': 'El carrito está vacío.'}

        # ✅ CORRECCIÓN: Limpieza y validación de datos antes de enviarlos al modelo
        clean_items = []
        for item in items:
            # Asegurar que quant_id existe y es convertible a int
            q_id = item.get('quant_id')
            l_id = item.get('lot_id')
            
            if q_id and str(q_id).isdigit():
                # Si lot_id viene sucio, lo dejamos pasar, el modelo lo recalcula
                clean_items.append({
                    'quant_id': int(q_id),
                    'lot_id': int(l_id) if l_id and str(l_id).isdigit() else 0,
                    'name': item.get('name', 'Producto')
                })

        if not clean_items:
            return {'success': False, 'message': 'Datos de items inválidos.'}

        try:
            return share.create_public_hold_order(clean_items)
        except Exception as e:
            # Loguear el error real en consola para debugging
            print(f"Gallery Reservation Error: {str(e)}")
            return {'success': False, 'message': str(e)}