# -*- coding: utf-8 -*-
from odoo import http, fields
from odoo.http import request
from collections import defaultdict

class GalleryController(http.Controller):

    @http.route('/gallery/view/<string:token>', type='http', auth='public', website=True)
    def view_gallery(self, token, **kwargs):
        # Buscar el registro por token
        share = request.env['gallery.share'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)

        # Validaciones
        if not share:
            return request.render('galeria.gallery_not_found', {})
        
        if share.is_expired:
            return request.render('galeria.gallery_expired', {'share': share})

        # Agrupar imágenes por Categoría Hija del producto
        # Estructura: { 'Mármol Blanco': [img1, img2], 'Granito': [img3] }
        grouped_images = defaultdict(list)
        
        for image in share.image_ids:
            # Obtener categoría: Intentar obtener la más específica
            categ = image.lot_id.product_id.categ_id
            categ_name = categ.name if categ else "Sin Categoría"
            
            # Datos para el Bento Grid
            img_data = {
                'id': image.id,
                'name': image.name or image.lot_id.name,
                'lot_name': image.lot_id.name,
                'dimensions': f"{image.lot_id.x_alto} x {image.lot_id.x_ancho} m" if hasattr(image.lot_id, 'x_alto') else "",
                'url': f"/web/image/stock.lot.image/{image.id}/image",
                # Lógica simple para Bento: si la secuencia es par, puede ser grande (simulado en CSS)
                'is_large': image.sequence % 5 == 0  
            }
            grouped_images[categ_name].append(img_data)

        values = {
            'share': share,
            'grouped_images': dict(grouped_images),
            'company': request.env.company
        }
        return request.render('galeria.gallery_public_view', values)
