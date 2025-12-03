# -*- coding: utf-8 -*-
import base64
import io
from odoo import http
from odoo.http import request
from collections import defaultdict
from werkzeug.exceptions import NotFound

class GalleryController(http.Controller):

    @http.route('/gallery/view/<string:token>', type='http', auth='public', csrf=False)
    def view_gallery(self, token, **kwargs):
        # Buscar el registro por token (sudo para saltar reglas de compañía si es necesario)
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share:
            return request.render('galeria.gallery_not_found', {})
        
        if share.is_expired:
            return request.render('galeria.gallery_expired', {'share': share})

        # Agrupar imágenes
        grouped_images = defaultdict(list)
        
        for image in share.image_ids:
            categ = image.lot_id.product_id.categ_id
            categ_name = categ.name if categ else "General"
            
            # Usamos nuestra propia ruta de imagen segura
            # Pasamos el token para validar permiso de ver esta imagen específica
            img_url = f"/gallery/image/{token}/{image.id}"
            
            img_data = {
                'id': image.id,
                'name': image.name or image.lot_id.name,
                'lot_name': image.lot_id.name,
                'dimensions': f"{image.lot_id.x_alto} x {image.lot_id.x_ancho} m" if hasattr(image.lot_id, 'x_alto') and image.lot_id.x_alto else "",
                'url': img_url,
                'is_large': image.sequence % 5 == 0  
            }
            grouped_images[categ_name].append(img_data)

        values = {
            'share': share,
            'grouped_images': dict(grouped_images),
            'company': share.user_id.company_id or request.env.company
        }
        return request.render('galeria.gallery_public_view', values)

    @http.route('/gallery/image/<string:token>/<int:image_id>', type='http', auth='public')
    def view_gallery_image(self, token, image_id, **kwargs):
        """
        Sirve la imagen binaria directamente para evitar chequeos de sesión de Odoo estándar.
        Valida que la imagen pertenezca a una galería activa con ese token.
        """
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        if not share or share.is_expired:
            return request.not_found()

        # Verificar que la imagen solicitada está en esta galería
        image = request.env['stock.lot.image'].sudo().browse(image_id)
        if image.id not in share.image_ids.ids:
            return request.not_found()

        if not image.image:
            return request.not_found()

        # Decodificar y servir
        image_data = base64.b64decode(image.image)
        headers = [
            ('Content-Type', 'image/jpeg'),
            ('Content-Length', len(image_data)),
            ('Cache-Control', 'public, max-age=604800') # Cache por 1 semana
        ]
        return request.make_response(image_data, headers)