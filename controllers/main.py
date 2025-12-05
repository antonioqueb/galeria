# -*- coding: utf-8 -*-
import base64
import json
import re
from odoo import http
from odoo.http import request
from collections import defaultdict
from markupsafe import Markup # <--- IMPORTANTE: Importar Markup

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

        # 1. Recolección de Datos Crudos
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
            if area <= 0: area = quant.quantity

            categ = lot.product_id.categ_id
            categ_name = categ.name if categ else "General"
            
            # Obtener nombre bloque o default
            block_name = str(lot.x_bloque) if hasattr(lot, 'x_bloque') and lot.x_bloque else "NO_BLOCK"

            item_data = {
                'id': image.id,
                'quant_id': quant.id,
                'lot_id': lot.id,
                'name': lot.product_id.name,
                'lot_name': lot.name,
                'block_name': block_name,
                'dimensions': f"{lot.x_alto:.2f} x {lot.x_ancho:.2f} m" if hasattr(lot, 'x_alto') else "",
                'area': round(area, 2),
                'url': f"/gallery/image/{token}/{image.id}",
                'write_date': str(image.write_date),
                'type': 'single',
                'is_large': False 
            }
            
            temp_storage[categ_name][block_name].append(item_data)

        # 2. Procesamiento de Regla (> 4 placas agrupa, <= 4 explota)
        final_grouped = defaultdict(list)
        blocks_data = {} 

        for categ, blocks in temp_storage.items():
            for block_name, items in blocks.items():
                
                # Si es un bloque real y tiene más de 4 items -> AGRUPAR
                if block_name != "NO_BLOCK" and len(items) > 4:
                    
                    total_area = sum(i['area'] for i in items)
                    first_img = items[0] # Imagen de referencia
                    
                    # Generar ID seguro
                    safe_block_name = re.sub(r'[^a-zA-Z0-9]', '_', block_name)
                    block_id = f"BLK_{safe_block_name}_{first_img['id']}"
                    
                    block_item = {
                        'id': block_id, 
                        'type': 'block',
                        'name': f"Bloque {block_name}", 
                        'lot_name': f"{len(items)} Placas",
                        'product_name': first_img['name'],
                        'dimensions': "Varias",
                        'area': round(total_area, 2),
                        'url': first_img['url'],
                        'is_large': False, 
                        'child_ids': [i['id'] for i in items],
                        'count': len(items)
                    }
                    
                    final_grouped[categ].append(block_item)
                    
                    # Guardar detalle para el drill-down en JS
                    # Al crear una lista nueva list(items), rompemos la referencia y aseguramos los datos
                    blocks_data[block_id] = list(items)
                
                else:
                    # Si son pocos o no tienen bloque, se muestran como singles
                    for item in items:
                        final_grouped[categ].append(item)

        # Serializamos los datos
        js_gallery_data = {
            'initial_view': dict(final_grouped),
            'blocks_details': blocks_data, 
            'token': token
        }

        # --- CORRECCIÓN CRÍTICA AQUÍ ---
        # Usamos Markup para evitar que Odoo escape las comillas del JSON en el HTML
        # Si no usas Markup, 'json_data' llega al HTML como &quot;...&quot; y rompe el script JS.
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
            print(f"Gallery Reservation Error: {str(e)}")
            return {'success': False, 'message': str(e)}