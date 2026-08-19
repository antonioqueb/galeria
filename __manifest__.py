# -*- coding: utf-8 -*-
{
    'name': 'Galería de Placas y Catálogo Compartido',
    'version': '19.0.3.5.0',
    'category': 'Sales/Sales',
    'summary': 'Selección visual de placas, carrito de reservas y catálogo público',
    'description': """
        Módulo para gestión de galería de imágenes de lotes (placas).
        Funcionalidades:
        - Selector visual tipo Grid (Backend) usando OWL.
        - Generación de enlaces únicos temporales para clientes.
        - Vista pública estilo Bento Grid agrupada por categorías.
        - Carrito de compras público (Sidecar) y reservas automáticas.
    """,
    'author': 'Alphaqueb Consulting',
    'depends': ['base', 'web', 'stock', 'stock_lot_dimensions', 'inventory_shopping_cart', 'inventory_visual_enhanced'],
    'data': [
        'security/ir.model.access.csv',
        'data/gallery_sequence.xml',
        'views/gallery_share_views.xml',
        'views/gallery_menus.xml',
        'views/gallery_public_template.xml',
        'views/vision_menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'galeria/static/src/js/gallery_selector.js',
            'galeria/static/src/xml/gallery_selector.xml',
            'galeria/static/src/scss/gallery_selector.scss',
            'galeria/static/src/js/vision_search.js',
            'galeria/static/src/xml/vision_search.xml',
            'galeria/static/src/scss/vision_search.scss',
        ],
        'web.assets_frontend': [
            'galeria/static/src/scss/gallery_public.scss',
            'galeria/static/src/js/gallery_public.js',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}