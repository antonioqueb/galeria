# -*- coding: utf-8 -*-
import base64
import json
import re
from odoo import http
from odoo.http import request
from collections import defaultdict
from markupsafe import Markup

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

        StockQuant = request.env['stock.quant'].sudo().with_company(share.company_id)

        # Estructura temporal: temp_storage[categoria][nombre_bloque] = [items...]
        temp_storage = defaultdict(lambda: defaultdict(list))

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

            # Calcular Área
            area = 0.0
            if hasattr(lot, 'x_alto') and hasattr(lot, 'x_ancho'):
                area = (lot.x_alto or 0) * (lot.x_ancho or 0)
            if area <= 0:
                area = quant.quantity

            categ = lot.product_id.categ_id
            categ_name = categ.name if categ else "General"

            # ---- FIX AGRUPACIÓN: Manejo robusto de x_bloque ----
            # x_bloque puede ser: string, int, float, False, None, 0
            raw_bloque = getattr(lot, 'x_bloque', None)
            if raw_bloque and str(raw_bloque).strip() and str(raw_bloque).strip() != '0':
                block_name = str(raw_bloque).strip()
            else:
                block_name = "NO_BLOCK"

            item_data = {
                'id': image.id,
                'quant_id': quant.id,
                'lot_id': lot.id,
                'name': lot.product_id.name,
                'lot_name': lot.name,
                'block_name': block_name,
                'dimensions': "{:.2f} x {:.2f} m".format(lot.x_alto, lot.x_ancho) if hasattr(lot, 'x_alto') and lot.x_alto else "",
                'area': round(area, 2),
                'url': "/gallery/image/{}/{}".format(token, image.id),
                'write_date': str(image.write_date),
                'type': 'single',
                'is_large': False
            }

            temp_storage[categ_name][block_name].append(item_data)

        # ---- PROCESAMIENTO: >= 2 placas en mismo bloque real -> AGRUPAR ----
        # (antes era > 4, ahora lo dejamos configurable; usamos >= 2 para que 
        #  siempre que haya bloque real con más de 1 placa se agrupe)
        BLOCK_THRESHOLD = 2  # Mínimo de placas para agrupar en bloque

        final_grouped = defaultdict(list)
        blocks_data = {}

        for categ, blocks in temp_storage.items():
            for block_name, items in blocks.items():

                # Agrupar si: tiene nombre de bloque real Y cumple el mínimo
                if block_name != "NO_BLOCK" and len(items) >= BLOCK_THRESHOLD:

                    total_area = sum(i['area'] for i in items)
                    first_img = items[0]

                    # Generar ID de bloque seguro y reproducible
                    safe_block_name = re.sub(r'[^a-zA-Z0-9]', '_', block_name)
                    block_id = "BLK_{}_{}".format(safe_block_name, first_img['id'])

                    block_item = {
                        'id': block_id,
                        'type': 'block',
                        'name': "Bloque {}".format(block_name),
                        'lot_name': "{} Placas".format(len(items)),
                        'product_name': first_img['name'],
                        'dimensions': "Varias",
                        'area': round(total_area, 2),
                        'url': first_img['url'],
                        'is_large': False,
                        'child_ids': [i['id'] for i in items],
                        'count': len(items)
                    }

                    final_grouped[categ].append(block_item)

                    # Guardar el detalle de cada placa para el drill-down en JS
                    # Usamos list(items) para romper la referencia al defaultdict
                    blocks_data[block_id] = list(items)

                else:
                    # Singles: sin bloque o bloque con 1 sola placa
                    for item in items:
                        final_grouped[categ].append(item)

        # Debug en log del servidor (quitar en producción si se desea)
        import logging
        _logger = logging.getLogger(__name__)
        _logger.info(
            "[Gallery] Token=%s | Categorías=%d | Bloques agrupados=%d | Singles=%d",
            token,
            len(final_grouped),
            len(blocks_data),
            sum(1 for cat_items in final_grouped.values() for i in cat_items if i['type'] == 'single')
        )

        js_gallery_data = {
            'initial_view': dict(final_grouped),
            'blocks_details': blocks_data,
            'token': token
        }

        values = {
            'share': share,
            'grouped_images': dict(final_grouped),
            'json_data': Markup(json.dumps(js_gallery_data)),
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

        image = request.env['stock.lot.image'].sudo().browse(image_id)
        if not image.exists() or not image.image:
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

        clean_items = []
        for item in items:
            q_id = item.get('quant_id')
            l_id = item.get('lot_id')

            if q_id and str(q_id).isdigit():
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
            import logging
            logging.getLogger(__name__).error("Gallery Reservation Error: %s", str(e))
            return {'success': False, 'message': str(e)}