# -*- coding: utf-8 -*-
import base64
import json
import re
import logging
from collections import defaultdict

from markupsafe import Markup

from odoo import http, fields
from odoo.http import request

_logger = logging.getLogger(__name__)

# === Reglas de agrupación visual ===
# Un bloque (lotes con mismo x_bloque) se muestra agrupado solo si:
#   1. Tiene 5 o más placas (más de 4)
#   2. El producto al que pertenece tiene 4 o más bloques que cumplen (1)
# De lo contrario, las placas se muestran individuales (evita cards solitarios).
THRESHOLD_BLOCK_SIZE = 5
THRESHOLD_PRODUCT_BLOCKS = 4


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

        # -------------------------------------------------------------
        # 1. Recolección de items válidos (con stock real y sin holds)
        # -------------------------------------------------------------
        valid_items = []

        for image in share.image_ids:
            lot = image.lot_id
            if not lot:
                continue

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

            alto = getattr(lot, 'x_alto', 0.0) or 0.0
            ancho = getattr(lot, 'x_ancho', 0.0) or 0.0
            area = alto * ancho if alto and ancho else quant.quantity
            area = round(area, 2)

            categ = lot.product_id.categ_id
            categ_name = categ.name if categ else "General"

            raw_bloque = getattr(lot, 'x_bloque', None)
            if raw_bloque and str(raw_bloque).strip() and str(raw_bloque).strip() != '0':
                block_name = str(raw_bloque).strip()
            else:
                block_name = None  # placa solitaria, sin bloque

            valid_items.append({
                'image_id': image.id,
                'quant_id': quant.id,
                'lot_id': lot.id,
                'lot_name': lot.name,
                'product_id': lot.product_id.id,
                'product_name': lot.product_id.name,
                'categ_name': categ_name,
                'block_name': block_name,
                'alto': alto,
                'ancho': ancho,
                'area': area,
                'dimensions': "{:.2f} x {:.2f} m".format(alto, ancho) if alto else "",
                'url': "/gallery/image/{}/{}".format(token, image.id),
                'write_date': str(image.write_date),
            })

        # -------------------------------------------------------------
        # 2. Agrupar items por (producto, bloque)
        # -------------------------------------------------------------
        block_map = defaultdict(list)
        loose_items = []  # placas sin bloque, van directo a individuales

        for item in valid_items:
            if item['block_name']:
                block_map[(item['product_id'], item['block_name'])].append(item)
            else:
                loose_items.append(item)

        # -------------------------------------------------------------
        # 3. Contar bloques "grandes" (>= THRESHOLD_BLOCK_SIZE) por producto
        # -------------------------------------------------------------
        big_blocks_per_product = defaultdict(int)
        for (prod_id, _block), items in block_map.items():
            if len(items) >= THRESHOLD_BLOCK_SIZE:
                big_blocks_per_product[prod_id] += 1

        eligible_products = {
            pid for pid, count in big_blocks_per_product.items()
            if count >= THRESHOLD_PRODUCT_BLOCKS
        }

        # -------------------------------------------------------------
        # 4. Construir vista final agrupada por categoría
        # -------------------------------------------------------------
        final_grouped = defaultdict(list)
        blocks_data = {}

        def build_single(i):
            return {
                'id': i['image_id'],
                'quant_id': i['quant_id'],
                'lot_id': i['lot_id'],
                'name': i['product_name'],
                'product_name': i['product_name'],
                'lot_name': i['lot_name'],
                'block_name': i['block_name'] or '',
                'dimensions': i['dimensions'],
                'area': i['area'],
                'url': i['url'],
                'write_date': i['write_date'],
                'type': 'single',
            }

        # 4a. Bloques agrupables vs expandibles
        for (prod_id, block_name), items in block_map.items():
            first = items[0]
            categ = first['categ_name']

            should_group = (
                prod_id in eligible_products
                and len(items) >= THRESHOLD_BLOCK_SIZE
            )

            if should_group:
                total_area = round(sum(i['area'] for i in items), 2)
                safe_block = re.sub(r'[^a-zA-Z0-9]', '_', block_name)
                block_id = "BLK_{}_{}".format(safe_block, first['image_id'])

                children = [build_single(i) for i in items]

                block_item = {
                    'id': block_id,
                    'type': 'block',
                    'name': "Bloque {}".format(block_name),
                    'product_name': first['product_name'],
                    'lot_name': "{} placas".format(len(items)),
                    'dimensions': 'Variadas',
                    'area': total_area,
                    'url': first['url'],
                    'child_ids': [c['id'] for c in children],
                    'count': len(items),
                    'block_name': block_name,
                }
                final_grouped[categ].append(block_item)
                blocks_data[block_id] = children
            else:
                # expandir a singles
                for i in items:
                    final_grouped[i['categ_name']].append(build_single(i))

        # 4b. Items sin bloque (sueltos)
        for i in loose_items:
            final_grouped[i['categ_name']].append(build_single(i))

        # -------------------------------------------------------------
        # 5. Stats globales (para hero / sesgo de escasez REAL)
        # -------------------------------------------------------------
        total_pieces = len(valid_items)
        total_area = round(sum(i['area'] for i in valid_items), 2)
        categories_count = len(final_grouped)

        now = fields.Datetime.now()
        days_left = 0
        if share.expiration_date:
            delta = share.expiration_date - now
            days_left = max(0, delta.days)

        # Ordenar items dentro de cada categoría: bloques primero, luego singles por área desc
        for categ in final_grouped:
            final_grouped[categ].sort(key=lambda x: (
                0 if x['type'] == 'block' else 1,
                -float(x.get('area') or 0)
            ))

        # Ordenar categorías por cantidad de items desc
        ordered_categories = dict(sorted(
            final_grouped.items(),
            key=lambda kv: -len(kv[1])
        ))

        _logger.info(
            "[Gallery] Token=%s | Categorías=%d | Bloques=%d | Singles=%d | Total=%d placas",
            token, categories_count, len(blocks_data),
            sum(1 for cat in ordered_categories.values() for i in cat if i['type'] == 'single'),
            total_pieces,
        )

        js_gallery_data = {
            'initial_view': ordered_categories,
            'blocks_details': blocks_data,
            'token': token,
            'total_pieces': total_pieces,
            'total_area': total_area,
            'days_left': days_left,
            'partner_name': share.partner_id.name or '',
            'salesperson': share.user_id.name or '',
        }

        values = {
            'share': share,
            'grouped_images': ordered_categories,
            'json_data': Markup(json.dumps(js_gallery_data)),
            'company': share.company_id,
            'token': token,
            'total_pieces': total_pieces,
            'total_area': total_area,
            'categories_count': categories_count,
            'days_left': days_left,
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
            ('Cache-Control', 'public, max-age=604800'),
        ]
        return request.make_response(image_data, headers)

    @http.route('/gallery/confirm_reservation', type='jsonrpc', auth='public', csrf=False)
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
                    'name': item.get('name', 'Producto'),
                })

        if not clean_items:
            return {'success': False, 'message': 'Datos de items inválidos.'}

        try:
            return share.create_public_hold_order(clean_items)
        except Exception as e:
            _logger.exception("Gallery Reservation Error")
            return {'success': False, 'message': str(e)}