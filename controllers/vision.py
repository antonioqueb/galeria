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
            'imagen_url': '/web/image/stock.lot.image/%s/image' % img_id if img_id else '',
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
        try:
            limite = int(kw.get('limite') or 24)
            r = requests.post(
                '%s/buscar' % _base_url(),
                params={'limite': limite},
                files={'foto': (archivo.filename, archivo.stream, archivo.mimetype)},
                timeout=TIMEOUT,
            )
            r.raise_for_status()
            datos = _enriquecer(r.json().get('resultados', []))
            return request.make_json_response({'ok': True, 'resultados': datos})
        except Exception as exc:  # noqa: BLE001
            _logger.warning('Búsqueda por imagen falló: %s', exc)
            return request.make_json_response(
                {'ok': False, 'error': 'No se pudo procesar la imagen'}
            )
