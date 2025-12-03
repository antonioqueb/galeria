# -*- coding: utf-8 -*-
{
    'name': 'Galería de Placas y Catálogo Compartido',
    'version': '19.0.1.0.0',
    'category': 'Sales/Sales',
    'summary': 'Selección visual de placas y generación de catálogos públicos temporales',
    'description': """
        Módulo para gestión de galería de imágenes de lotes (placas).
        Funcionalidades:
        - Selector visual tipo Grid (Backend) usando OWL.
        - Generación de enlaces únicos temporales para clientes.
        - Vista pública estilo Bento Grid agrupada por categorías.
    """,
    'author': 'Alphaqueb Consulting',
    'depends': ['base', 'web', 'stock', 'stock_lot_dimensions', 'website'],
    'data': [
        'security/ir.model.access.csv',
        'views/gallery_share_views.xml',
        'views/gallery_menus.xml',
        'views/gallery_public_template.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'galeria/static/src/js/gallery_selector.js',
            'galeria/static/src/xml/gallery_selector.xml',
            'galeria/static/src/scss/gallery_selector.scss',
        ],
        'web.assets_frontend': [
            'galeria/static/src/scss/gallery_public.scss',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
