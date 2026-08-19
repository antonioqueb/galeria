# -*- coding: utf-8 -*-
"""Puente entre Odoo y el servicio de búsqueda visual.

El navegador NUNCA habla directo con el servicio de visión: llama a Odoo y
Odoo reenvía. Así el servicio sigue escuchando solo en la red interna y hereda
el control de acceso del ERP — quien no tiene sesión, no busca.
"""
import json
import logging

import requests

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)

TIMEOUT = 60


def _base_url():
    """URL del servicio de visión. Configurable por parámetro del sistema."""
    return request.env['ir.config_parameter'].sudo().get_param(
        'som_vision.url', 'http://som-vision-api:8000'
    )


def _enriquecer(resultados):
    """Añade a cada resultado lo que hace falta para pintarlo.

    El servicio de visión solo conoce ids de adjunto; los datos del lote y la
    URL de la imagen salen de Odoo.
    """
    if not resultados:
        return []

    att_ids = [r['attachment_id'] for r in resultados]
    adjuntos = request.env['ir.attachment'].sudo().browse(att_ids)
    # attachment_id -> id del registro stock.lot.image que lo contiene
    res_por_att = {a.id: a.res_id for a in adjuntos if a.exists()}

    lot_ids = [r['lot_id'] for r in resultados if r.get('lot_id')]
    lotes = request.env['stock.lot'].sudo().browse(lot_ids)
    lote_por_id = {l.id: l for l in lotes if l.exists()}

    mejor = max((r.get('parecido') or 0) for r in resultados) or 1

    salida = []
    for r in resultados:
        lote = lote_por_id.get(r.get('lot_id'))
        img_id = res_por_att.get(r['attachment_id'])
        salida.append({
            'lot_id': r.get('lot_id'),
            'lot_name': r.get('lot_name') or (lote.name if lote else ''),
            'producto': lote.product_id.display_name if lote and lote.product_id else '',
            # Miniatura para la retícula e imagen completa para el visor:
            # 24 fotos a tamaño real serían decenas de MB por búsqueda.
            'imagen_url': '/web/image/stock.lot.image/%s/image_small' % img_id if img_id else '',
            'imagen_grande': '/web/image/stock.lot.image/%s/image' % img_id if img_id else '',
            # Relativo al mejor resultado: el valor absoluto de CLIP no es
            # comparable entre texto e imagen (texto ronda 0.3, imagen 0.8),
            # así que mostrarlo como porcentaje confundiría al usuario.
            'relativo': round((r.get('parecido') or 0) / mejor * 100),
        })
    return salida


class SomVisionController(http.Controller):

    # Odoo 19: type='jsonrpc'. El antiguo type='json' sigue funcionando como
    # alias, pero emite DeprecationWarning en cada arranque.

    @http.route('/som_vision/estado', type='jsonrpc', auth='user')
    def estado(self):
        try:
            r = requests.get('%s/salud' % _base_url(), timeout=10)
            r.raise_for_status()
            return {'ok': True, **r.json()}
        except Exception as exc:  # noqa: BLE001
            _logger.warning('Visión no disponible: %s', exc)
            return {'ok': False, 'error': 'El servicio de búsqueda visual no responde'}

    @http.route('/som_vision/buscar_texto', type='jsonrpc', auth='user')
    def buscar_texto(self, q='', limite=24):
        q = (q or '').strip()
        if len(q) < 2:
            return {'ok': False, 'error': 'Escribe al menos dos letras'}
        try:
            r = requests.post(
                '%s/buscar-texto' % _base_url(),
                params={'q': q, 'limite': int(limite)},
                timeout=TIMEOUT,
            )
            r.raise_for_status()
            return {'ok': True, 'resultados': _enriquecer(r.json().get('resultados', []))}
        except Exception as exc:  # noqa: BLE001
            _logger.warning('Búsqueda por texto falló: %s', exc)
            return {'ok': False, 'error': 'No se pudo completar la búsqueda'}

    @http.route('/som_vision/buscar_imagen', type='http', auth='user', methods=['POST'])
    def buscar_imagen(self, **kw):
        archivo = request.httprequest.files.get('foto')
        if not archivo:
            return request.make_json_response({'ok': False, 'error': 'Falta la imagen'})
        # Se leen los BYTES, no se reenvía archivo.stream: Odoo ya consumió ese
        # flujo al parsear el formulario, así que llegaba vacío al servicio de
        # visión y respondía 400 "la imagen no es legible".
        contenido = archivo.read()
        if not contenido:
            return request.make_json_response(
                {'ok': False, 'error': 'La imagen llegó vacía'}
            )

        # NORMALIZACIÓN A JPEG antes de reenviar: el navegador puede mandar
        # WEBP, HEIC, PNG con alfa o CMYK y el servicio de visión respondía
        # 400 'imagen no legible'. Transcodificando aquí, el servicio recibe
        # siempre lo mismo. OJO Odoo 19 anula Image.init() dentro del
        # worker: los plugins de Pillow se importan EXPLÍCITOS o el open()
        # truena con UnidentifiedImageError aunque la librería los tenga.
        try:
            import io
            from PIL import Image
            import PIL.JpegImagePlugin   # noqa: F401
            import PIL.PngImagePlugin    # noqa: F401
            import PIL.WebPImagePlugin   # noqa: F401
            import PIL.GifImagePlugin    # noqa: F401
            import PIL.BmpImagePlugin    # noqa: F401
            import PIL.TiffImagePlugin   # noqa: F401

            img = Image.open(io.BytesIO(contenido))
            img = img.convert('RGB')
            # Tope de tamaño: para similitud no se necesita más, y recorta
            # el payload al servicio (nginx ya bufferea a disco los grandes).
            img.thumbnail((1600, 1600))
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=92)
            contenido = buf.getvalue()
        except Exception:
            _logger.warning(
                'Imagen de búsqueda no decodificable (mimetype=%s, %s bytes)',
                archivo.mimetype, len(contenido))
            return request.make_json_response({
                'ok': False,
                'error': 'Formato de imagen no soportado. '
                         'Usa una foto JPG o PNG.',
            })

        try:
            limite = int(kw.get('limite') or 24)
            r = requests.post(
                '%s/buscar' % _base_url(),
                params={'limite': limite},
                files={'foto': ('consulta.jpg', contenido, 'image/jpeg')},
                timeout=TIMEOUT,
            )
            if r.status_code >= 400:
                # El detalle del servicio va al log: sin esto el 400 era
                # ciego y no se sabía QUÉ rechazó.
                _logger.warning(
                    'Visión respondió %s en /buscar: %s',
                    r.status_code, (r.text or '')[:500])
            r.raise_for_status()
            datos = _enriquecer(r.json().get('resultados', []))
            return request.make_json_response({'ok': True, 'resultados': datos})
        except Exception as exc:  # noqa: BLE001
            _logger.warning('Búsqueda por imagen falló: %s', exc)
            return request.make_json_response(
                {'ok': False, 'error': 'No se pudo procesar la imagen'}
            )
