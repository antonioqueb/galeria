/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart, useRef, xml } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { useDebounced } from "@web/core/utils/timing";

// --- Componente Modal ---
class CreateLinkDialog extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.action = useService("action");
        
        this.state = useState({ 
            partner_id: false, 
            query: "",          
            suggestions: []     
        });

        this.debouncedSearch = useDebounced(async (term) => {
            if (!term || term.length < 2) {
                this.state.suggestions = [];
                return;
            }
            try {
                const results = await this.orm.searchRead(
                    "res.partner", 
                    [['name', 'ilike', term]], 
                    ["id", "name", "email"], 
                    { limit: 10 }
                );
                this.state.suggestions = results;
            } catch (e) {
                console.error(e);
            }
        }, 300);
    }

    onInputSearch(ev) {
        const term = ev.target.value;
        this.state.query = term;
        if (term === "") {
            this.state.partner_id = false;
            this.state.suggestions = [];
        } else {
            this.debouncedSearch(term);
        }
    }

    selectPartner(partner) {
        this.state.partner_id = partner.id;
        this.state.query = partner.name; 
        this.state.suggestions = [];     
    }

    async confirm() {
        if (!this.state.partner_id) {
            this.notification.add("Debes buscar y seleccionar un contacto válido", { type: "danger" });
            return;
        }
        try {
            const result = await this.orm.call("gallery.share", "create_from_selector", [
                parseInt(this.state.partner_id),
                this.props.selectedImages
            ]);
            this.props.close();
            this.action.doAction({
                type: 'ir.actions.act_window',
                res_model: 'gallery.share',
                res_id: result.id,
                views: [[false, 'form']],
                target: 'current',
            });
        } catch (error) {
            this.notification.add(error.message, { type: "danger" });
        }
    }
}

CreateLinkDialog.template = xml`
    <Dialog title="props.title">
        <div class="p-4">
            <div class="mb-4 text-center">
                <div class="bg-light rounded-circle d-inline-flex p-3 mb-2 text-primary">
                    <i class="fa fa-share-alt fa-2x"/>
                </div>
                <h5>Compartir <strong class="text-primary"><t t-esc="props.selectedImages.length"/></strong> imágenes</h5>
            </div>

            <div class="mb-3 position-relative">
                <label class="form-label fw-bold">Buscar Cliente</label>
                <div class="input-group">
                    <span class="input-group-text"><i class="fa fa-search"/></span>
                    <input type="text" 
                            class="form-control form-control-lg" 
                            placeholder="Escribe nombre del cliente..." 
                            t-att-value="state.query"
                            t-on-input="onInputSearch"
                            autocomplete="off"/>
                </div>
                <div t-if="state.suggestions.length > 0" 
                        class="list-group position-absolute w-100 shadow-lg" 
                        style="z-index: 1000; max-height: 200px; overflow-y: auto;">
                    <t t-foreach="state.suggestions" t-as="p" t-key="p.id">
                        <button type="button" 
                                class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                                t-on-click="() => this.selectPartner(p)">
                            <div>
                                <div class="fw-bold"><t t-esc="p.name"/></div>
                                <small t-if="p.email" class="text-muted"><t t-esc="p.email"/></small>
                            </div>
                            <i class="fa fa-check text-primary" t-if="state.partner_id === p.id"/>
                        </button>
                    </t>
                </div>
            </div>
            
            <div t-if="state.partner_id" class="alert alert-success py-2 d-flex align-items-center">
                <i class="fa fa-check-circle me-2"/> Cliente seleccionado
            </div>
        </div>
        <t t-set-slot="footer">
            <button class="btn btn-light" t-on-click="props.close">Cancelar</button>
            <button class="btn btn-primary px-4" t-on-click="confirm" t-att-disabled="!state.partner_id">Generar Link</button>
        </t>
    </Dialog>
`;

CreateLinkDialog.components = { Dialog };

// --- Componente Principal ---
export class GallerySelector extends Component {
    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.scrollRef = useRef("scrollContainer");
        
        this.state = useState({
            // Paginación
            allItems: [],       
            visibleItems: [],   
            pageSize: 40,
            currentPage: 1,

            // Filtros activos
            filters: {
                product_name: '',
                almacen_id: '',
                ubicacion_id: '',
                tipo: '',
                categoria_name: '',
                grupo: '',
                marca: '',
                grosor: '',
                numero_serie: '',
                bloque: '',
                pedimento: '',
                contenedor: '',
                atado: '',
                color: '',
                alto_min: '',
                ancho_min: '',
                price_currency: '',
                price_level: '',
                price_min: '',
                price_max: '',
            },

            // Opciones para dropdowns
            almacenes: [],
            ubicaciones: [],
            tipos: [],
            categorias: [],
            grupos: [],
            marcas: [],
            grosores: [],
            colores: [],

            // UI
            showAdvancedFilters: false,
            mobileFiltersOpen: false,
            activeBlock: null,
            selectedIds: new Set(),
            currentCompanyId: null,
            loading: false,
        });

        this.searchTimeout = null;
        this.debouncedLoad = useDebounced(() => this.loadImages(), 500);

        onWillStart(async () => {
            try {
                this.state.currentCompanyId = await this.orm.call("gallery.share", "get_current_company", []);
            } catch (e) { console.error("Error company:", e); }

            await this.loadFilterOptions();
            await this.loadImages();
        });
    }

    // =========================================================
    //  CARGA DE OPCIONES PARA FILTROS
    // =========================================================

    async loadFilterOptions() {
        try {
            // Almacenes
            this.state.almacenes = await this.orm.searchRead(
                "stock.warehouse", [], ["id", "name"], { order: "name" }
            );

            // Tipos (selection field de stock.quant)
            try {
                const fields = await this.orm.call("stock.lot", "fields_get", [["x_tipo"]], { attributes: ["selection"] });
                this.state.tipos = fields.x_tipo ? fields.x_tipo.selection : [];
            } catch(e) { this.state.tipos = []; }

            // Categorías de producto
            this.state.categorias = await this.orm.searchRead(
                "product.category", [], ["id", "name"], { order: "name", limit: 100 }
            );

            // Grupos (bloques únicos)
            try {
                const lots = await this.orm.searchRead(
                    "stock.lot", [["x_bloque", "!=", false]], ["x_bloque"], { limit: 500 }
                );
                const uniq = [...new Set(lots.map(l => l.x_bloque).filter(Boolean))].sort();
                this.state.grupos = uniq.map(b => [b, b]);
            } catch(e) { this.state.grupos = []; }

            // Grosores únicos
            try {
                const grosores = await this.orm.call(
                    "stock.quant", "read_group",
                    [[["x_grosor", "!=", false], ["quantity", ">", 0]]],
                    { groupby: ["x_grosor"], fields: ["x_grosor"] }
                );
                const grosorSet = new Set();
                grosores.forEach(g => { if (g.x_grosor) grosorSet.add(g.x_grosor); });
                this.state.grosores = Array.from(grosorSet).sort((a, b) => a - b);
            } catch(e) { this.state.grosores = []; }

            // Marcas (x_marca en product.template)
            try {
                const marcas = await this.orm.call(
                    "product.template", "read_group",
                    [[["x_marca", "!=", false]]],
                    { groupby: ["x_marca"], fields: ["x_marca"] }
                );
                this.state.marcas = marcas.map(m => m.x_marca).filter(Boolean).sort();
            } catch(e) { this.state.marcas = []; }

            // Colores únicos (x_color en stock.quant)
            try {
                const colores = await this.orm.call(
                    "stock.quant", "read_group",
                    [[["x_color", "!=", false], ["quantity", ">", 0]]],
                    { groupby: ["x_color"], fields: ["x_color"] }
                );
                this.state.colores = colores.map(c => c.x_color).filter(Boolean).sort();
            } catch(e) { this.state.colores = []; }

        } catch(e) {
            console.error("Error cargando opciones de filtros:", e);
        }
    }

    async onAlmacenChange(ev) {
        this.state.filters.almacen_id = ev.target.value;
        this.state.filters.ubicacion_id = '';
        this.state.ubicaciones = [];

        if (this.state.filters.almacen_id) {
            try {
                this.state.ubicaciones = await this.orm.searchRead(
                    "stock.location",
                    [
                        ["warehouse_id", "=", parseInt(this.state.filters.almacen_id)],
                        ["usage", "=", "internal"]
                    ],
                    ["id", "complete_name"],
                    { order: "complete_name" }
                );
            } catch(e) { this.state.ubicaciones = []; }
        }

        this.debouncedLoad();
    }

    // =========================================================
    //  EVENTOS DE FILTROS
    // =========================================================

    onFilterChange(field, ev) {
        this.state.filters[field] = ev.target.value;
        this.state.activeBlock = null;
        this.debouncedLoad();
    }

    onTextFilterChange(field, ev) {
        this.state.filters[field] = ev.target.value;
        this.state.activeBlock = null;
        this.debouncedLoad();
    }

    toggleAdvancedFilters() {
        this.state.showAdvancedFilters = !this.state.showAdvancedFilters;
    }

    toggleMobileFilters() {
        this.state.mobileFiltersOpen = !this.state.mobileFiltersOpen;
    }

    hasActiveFilters() {
        const f = this.state.filters;
        return !!(f.product_name || f.almacen_id || f.ubicacion_id || f.tipo ||
                  f.categoria_name || f.grupo || f.grosor || f.numero_serie ||
                  f.bloque || f.pedimento || f.contenedor || f.atado || f.color ||
                  f.alto_min || f.ancho_min || f.price_min || f.price_max);
    }

    clearAllFilters() {
        const filters = this.state.filters;
        Object.keys(filters).forEach(k => { filters[k] = ''; });
        this.state.ubicaciones = [];
        this.state.activeBlock = null;
        this.loadImages();
    }

    // =========================================================
    //  CARGA DE IMÁGENES
    // =========================================================

    async loadImages() {
        this.state.loading = true;
        this.state.currentPage = 1; 
        
        try {
            const f = this.state.filters;

            // --- Dominio base para stock.quant ---
            const quantDomain = [
                ['location_id.usage', '=', 'internal'],
                ['quantity', '>', 0],
                ['reserved_quantity', '=', 0],  
                ['x_tiene_hold', '=', false]    
            ];

            if (this.state.currentCompanyId) {
                quantDomain.unshift(['company_id', '=', this.state.currentCompanyId]);
            }

            // Filtro de almacén / ubicación
            if (f.ubicacion_id) {
                quantDomain.push(['location_id', '=', parseInt(f.ubicacion_id)]);
            } else if (f.almacen_id) {
                quantDomain.push(['location_id.warehouse_id', '=', parseInt(f.almacen_id)]);
            }

            // Modo bloque activo
            if (this.state.activeBlock) {
                quantDomain.push(['lot_id.x_bloque', '=', this.state.activeBlock]);
            } else {
                // Búsqueda por nombre de producto
                if (f.product_name && f.product_name.trim()) {
                    quantDomain.push(['product_id.name', 'ilike', f.product_name.trim()]);
                }
                // Tipo
                if (f.tipo) {
                    quantDomain.push(['lot_id.x_tipo', '=', f.tipo]);
                }
                // Categoría por nombre
                if (f.categoria_name && f.categoria_name.trim()) {
                    quantDomain.push(['product_id.categ_id.name', 'ilike', f.categoria_name.trim()]);
                }
                // Grupo (bloque)
                if (f.grupo && f.grupo.trim()) {
                    quantDomain.push(['lot_id.x_bloque', 'ilike', f.grupo.trim()]);
                }
                // Grosor/Espesor
                if (f.grosor) {
                    quantDomain.push(['lot_id.x_grosor', '=', parseFloat(f.grosor)]);
                }
                // Alto mínimo
                if (f.alto_min) {
                    try { quantDomain.push(['lot_id.x_alto', '>=', parseFloat(f.alto_min)]); } catch(e) {}
                }
                // Ancho mínimo
                if (f.ancho_min) {
                    try { quantDomain.push(['lot_id.x_ancho', '>=', parseFloat(f.ancho_min)]); } catch(e) {}
                }
                // Lote / Número de serie (múltiples separados por coma)
                if (f.numero_serie && f.numero_serie.trim()) {
                    const parts = f.numero_serie.split(',').map(s => s.trim()).filter(Boolean);
                    if (parts.length === 1) {
                        quantDomain.push(['lot_id.name', 'ilike', parts[0]]);
                    } else if (parts.length > 1) {
                        quantDomain.push(['lot_id.name', 'in', parts]);
                    }
                }
                // Bloque explícito
                if (f.bloque && f.bloque.trim()) {
                    quantDomain.push(['lot_id.x_bloque', 'ilike', f.bloque.trim()]);
                }
                // Pedimento
                if (f.pedimento && f.pedimento.trim()) {
                    quantDomain.push(['lot_id.x_pedimento', 'ilike', f.pedimento.trim()]);
                }
                // Contenedor
                if (f.contenedor && f.contenedor.trim()) {
                    quantDomain.push(['lot_id.x_contenedor', 'ilike', f.contenedor.trim()]);
                }
                // Atado
                if (f.atado && f.atado.trim()) {
                    quantDomain.push(['lot_id.x_atado', 'ilike', f.atado.trim()]);
                }
                // Color
                if (f.color && f.color.trim()) {
                    quantDomain.push(['lot_id.x_color', 'ilike', f.color.trim()]);
                }
                // Marca
                if (f.marca && f.marca.trim()) {
                    quantDomain.push(['product_id.product_tmpl_id.x_marca', 'ilike', f.marca.trim()]);
                }
            }

            const validQuants = await this.orm.searchRead(
                "stock.quant", quantDomain, ["lot_id", "product_id"], { limit: 2000 }
            );

            let validLotIds = validQuants.map(q => q.lot_id[0]);

            // Filtro de precios (post-query sobre product.template)
            if ((f.price_min || f.price_max) && f.price_currency && f.price_level) {
                const priceField = `x_price_${f.price_currency.toLowerCase()}_${f.price_level === 'high' ? '1' : '2'}`;
                const productIds = [...new Set(validQuants.map(q => q.product_id[0]))];
                
                const priceFilters = [['id', 'in', productIds]];
                if (f.price_min) priceFilters.push([priceField, '>=', parseFloat(f.price_min)]);
                if (f.price_max) priceFilters.push([priceField, '<=', parseFloat(f.price_max)]);

                try {
                    const matchedProducts = await this.orm.searchRead(
                        "product.product", priceFilters, ["id"], { limit: 2000 }
                    );
                    const matchedProductIds = new Set(matchedProducts.map(p => p.id));
                    const filteredQuants = validQuants.filter(q => matchedProductIds.has(q.product_id[0]));
                    validLotIds = filteredQuants.map(q => q.lot_id[0]);
                } catch(e) {
                    console.error("Error en filtro de precios:", e);
                }
            }

            if (validLotIds.length === 0) {
                this.state.allItems = [];
                this.state.visibleItems = [];
                this.state.loading = false;
                return;
            }

            const lotsData = await this.orm.read(
                "stock.lot", validLotIds, ["id", "name", "x_bloque", "x_alto", "x_ancho", "product_id"]
            );
            
            const lotMap = {};
            lotsData.forEach(l => {
                lotMap[l.id] = {
                    name: l.name,
                    block: l.x_bloque || false,
                    h: l.x_alto || 0,
                    w: l.x_ancho || 0,
                    product: l.product_id ? l.product_id[1] : 'Producto'
                };
            });

            const images = await this.orm.searchRead(
                "stock.lot.image", [['lot_id', 'in', validLotIds]], 
                ["id", "name", "lot_id", "write_date"], { order: "id desc" }
            );

            const grouped = {};
            const singleItems = [];
            const forceSingles = !!this.state.activeBlock;

            images.forEach(img => {
                const lData = lotMap[img.lot_id[0]];
                if (!lData) return;

                const imgObj = {
                    type: 'single',
                    key: img.id,
                    id: img.id, 
                    lot_name: lData.name,
                    name: lData.name, 
                    dims: `${lData.h.toFixed(2)} x ${lData.w.toFixed(2)}`,
                    area: (lData.h * lData.w),
                    unique: img.write_date,
                    product_name: lData.product,
                    cover_id: img.id,
                    cover_unique: img.write_date
                };

                if (lData.block && !forceSingles) {
                    if (!grouped[lData.block]) {
                        grouped[lData.block] = {
                            type: 'block',
                            key: lData.block,
                            name: `Bloque ${lData.block}`,
                            product_name: lData.product,
                            ids: [],      
                            items: [],    
                            total_area: 0,
                            cover_id: img.id, 
                            cover_unique: img.write_date
                        };
                    }
                    grouped[lData.block].ids.push(img.id);
                    grouped[lData.block].items.push(imgObj);
                    grouped[lData.block].total_area += imgObj.area;
                } else {
                    singleItems.push(imgObj);
                }
            });

            const blocks = Object.values(grouped);
            this.state.allItems = [...blocks, ...singleItems];
            this.loadMoreImages();

        } catch (e) {
            console.error("Error loading images:", e);
        } finally {
            this.state.loading = false;
        }
    }

    loadMoreImages() {
        const end = this.state.currentPage * this.state.pageSize;
        this.state.visibleItems = this.state.allItems.slice(0, end);
    }

    onScroll(ev) {
        const el = ev.target;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
            if (this.state.visibleItems.length < this.state.allItems.length) {
                this.state.currentPage++;
                this.loadMoreImages();
            }
        }
    }

    // =========================================================
    //  NAVEGACIÓN BLOQUES
    // =========================================================

    openBlock(blockName) {
        this.state.activeBlock = blockName;
        this.loadImages();
    }

    backToGallery() {
        this.state.activeBlock = null;
        this.loadImages();
    }

    // =========================================================
    //  SELECCIÓN
    // =========================================================

    toggleItemSelection(item) {
        if (item.type === 'block') {
            const allSelected = item.ids.every(id => this.state.selectedIds.has(id));
            if (allSelected) {
                item.ids.forEach(id => this.state.selectedIds.delete(id));
            } else {
                item.ids.forEach(id => this.state.selectedIds.add(id));
            }
        } else {
            if (this.state.selectedIds.has(item.id)) {
                this.state.selectedIds.delete(item.id);
            } else {
                this.state.selectedIds.add(item.id);
            }
        }
    }

    isBlockSelected(item) {
        if (item.type !== 'block') return false;
        return item.ids.length > 0 && item.ids.every(id => this.state.selectedIds.has(id));
    }

    selectAll() {
        this.state.allItems.forEach(item => {
            if (item.type === 'block') {
                item.ids.forEach(id => this.state.selectedIds.add(id));
            } else {
                this.state.selectedIds.add(item.id);
            }
        });
    }

    clearSelection() {
        this.state.selectedIds.clear();
    }

    createLink() {
        if (this.state.selectedIds.size === 0) return;
        this.dialog.add(CreateLinkDialog, {
            selectedImages: Array.from(this.state.selectedIds),
            title: "Generar Enlace Público"
        });
    }

    get isSomethingSelected() {
        return this.state.selectedIds.size > 0;
    }
}

GallerySelector.template = "galeria.GallerySelector";
registry.category("actions").add("galeria.selector_dashboard", GallerySelector);