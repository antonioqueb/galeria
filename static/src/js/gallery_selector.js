/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart, useRef } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { useDebounced } from "@web/core/utils/timing";

// --- Componente Modal (Sin cambios) ---
class CreateLinkDialog extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.action = useService("action");
        this.state = useState({ partner_id: false, partners: [] });

        onWillStart(async () => {
            try {
                this.state.partners = await this.orm.searchRead(
                    "res.partner", [], ["id", "name"], { limit: 80, order: "name asc" }
                );
            } catch (e) { console.error(e); }
        });
    }

    async confirm() {
        if (!this.state.partner_id) {
            this.notification.add("Debes seleccionar un contacto", { type: "danger" });
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
CreateLinkDialog.template = "galeria.CreateLinkDialog";
CreateLinkDialog.components = { Dialog };

// --- Componente Principal ---
export class GallerySelector extends Component {
    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.scrollRef = useRef("scrollContainer");
        
        this.state = useState({
            allItems: [],       // Elementos procesados (Bloques o Placas sueltas)
            visibleItems: [],   // Paginación visual
            pageSize: 40,
            currentPage: 1,
            
            categories: [],
            
            selectedCategory: "",
            filterProduct: "",  // Texto libre para producto
            filterBlock: "",
            filterBundle: "",
            search: "",         // Lote/Serie
            
            selectedIds: new Set(), // IDs de stock.lot.image seleccionados
            currentCompanyId: null,
            loading: false
        });

        this.debouncedLoad = useDebounced(() => this.loadImages(), 500);

        onWillStart(async () => {
            try {
                this.state.currentCompanyId = await this.orm.call("gallery.share", "get_current_company", []);
            } catch (e) { console.error("Error company:", e); }

            await this.loadCategories();
            await this.loadImages();
        });
    }

    async loadCategories() {
        try {
            const parent = await this.orm.searchRead("product.category", [['name', 'ilike', 'Placas']], ["id"], { limit: 1 });
            let domain = [];
            if (parent.length > 0) domain = [['parent_id', 'child_of', parent[0].id]];
            
            this.state.categories = await this.orm.searchRead("product.category", domain, ["id", "name"], { order: "name" });
        } catch (e) { console.error(e); }
    }

    async loadImages() {
        this.state.loading = true;
        this.state.currentPage = 1; 
        
        try {
            // 1. Construir dominio para Stock Quant (Disponibilidad)
            const quantDomain = [
                ['location_id.usage', '=', 'internal'],
                ['quantity', '>', 0],
                ['reserved_quantity', '=', 0],  
                ['x_tiene_hold', '=', false]    
            ];

            if (this.state.currentCompanyId) {
                quantDomain.unshift(['company_id', '=', this.state.currentCompanyId]);
            }

            // Filtros que aplican a nivel de Quant/Lote
            if (this.state.search) quantDomain.push(['lot_id.name', 'ilike', this.state.search]);
            if (this.state.filterBlock) quantDomain.push(['lot_id.x_bloque', 'ilike', this.state.filterBlock]);
            if (this.state.filterBundle) quantDomain.push(['lot_id.x_atado', 'ilike', this.state.filterBundle]);
            if (this.state.selectedCategory) quantDomain.push(['product_id.categ_id', 'child_of', parseInt(this.state.selectedCategory)]);
            
            // Filtro de Producto (Texto libre)
            if (this.state.filterProduct) {
                quantDomain.push(['product_id.name', 'ilike', this.state.filterProduct]);
            }

            // 2. Buscar Quants y obtener IDs de Lotes
            const validQuants = await this.orm.searchRead(
                "stock.quant", 
                quantDomain, 
                ["lot_id"], 
                { limit: 2000 } // Aumentamos límite para armar bien los bloques
            );

            const validLotIds = validQuants.map(q => q.lot_id[0]);

            if (validLotIds.length === 0) {
                this.state.allItems = [];
                this.state.visibleItems = [];
                this.state.loading = false;
                return;
            }

            // 3. Obtener información detallada de los Lotes (Dimensiones, Producto, Bloque)
            // Necesitamos leer 'stock.lot' para obtener x_alto, x_ancho, x_bloque y nombre real del producto
            const lotsData = await this.orm.read(
                "stock.lot",
                validLotIds,
                ["id", "name", "x_bloque", "x_alto", "x_ancho", "product_id"]
            );
            
            // Mapa rápido: LotID -> Data
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

            // 4. Buscar Imágenes asociadas a esos lotes
            const images = await this.orm.searchRead(
                "stock.lot.image", 
                [['lot_id', 'in', validLotIds]], 
                ["id", "name", "lot_id", "write_date"], 
                { order: "id desc" }
            );

            // 5. Agrupar Lógica (Por Bloque o Individual)
            const grouped = {};
            const singleItems = [];

            images.forEach(img => {
                const lData = lotMap[img.lot_id[0]];
                if (!lData) return;

                const imgObj = {
                    id: img.id, // ID de la imagen
                    lot_name: lData.name,
                    dims: `${lData.h.toFixed(2)} x ${lData.w.toFixed(2)}`,
                    area: (lData.h * lData.w),
                    unique: img.write_date,
                    product_name: lData.product
                };

                if (lData.block) {
                    // Es parte de un bloque
                    if (!grouped[lData.block]) {
                        grouped[lData.block] = {
                            type: 'block',
                            key: lData.block,
                            name: `Bloque ${lData.block}`,
                            product_name: lData.product, // Asumimos mismo producto por bloque
                            ids: [],      // Array de IDs de imágenes
                            items: [],    // Objetos de imagen completos
                            total_area: 0,
                            cover_id: img.id, // Primera imagen encontrada es la portada
                            cover_unique: img.write_date
                        };
                    }
                    grouped[lData.block].ids.push(img.id);
                    grouped[lData.block].items.push(imgObj);
                    grouped[lData.block].total_area += imgObj.area;
                } else {
                    // Es placa suelta
                    singleItems.push({
                        type: 'single',
                        key: img.id,
                        id: img.id,
                        name: lData.name, // Nombre del lote
                        product_name: lData.product,
                        dims: `${lData.h.toFixed(2)} x ${lData.w.toFixed(2)}`,
                        area: imgObj.area,
                        cover_unique: img.write_date
                    });
                }
            });

            // Convertir objeto agrupado a array y unir con singles
            const blocks = Object.values(grouped);
            
            // Ordenar: primero bloques, luego singles (opcional, por ahora mezclados por orden de carga)
            this.state.allItems = [...blocks, ...singleItems];
            
            // Recargar vista paginada
            this.loadMoreImages();

        } catch (e) {
            console.error("Error loading images:", e);
        } finally {
            this.state.loading = false;
        }
    }

    loadMoreImages() {
        const start = 0;
        const end = this.state.currentPage * this.state.pageSize;
        this.state.visibleItems = this.state.allItems.slice(start, end);
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

    // --- Eventos UI ---

    async onCategoryChange(ev) {
        this.state.selectedCategory = ev.target.value;
        await this.loadImages();
    }

    onInputSearch(ev, field) {
        this.state[field] = ev.target.value;
        this.debouncedLoad();
    }

    // Acción para "Entrar" en un bloque (filtrar por él)
    openBlock(blockName) {
        this.state.filterBlock = blockName;
        // Limpiamos otros filtros para enfocar, opcional
        this.state.search = ""; 
        this.loadImages();
    }

    toggleItemSelection(item) {
        if (item.type === 'block') {
            // Lógica para Bloque: Si todos están seleccionados, deseleccionar todos. Si no, seleccionar todos.
            const allSelected = item.ids.every(id => this.state.selectedIds.has(id));
            
            if (allSelected) {
                item.ids.forEach(id => this.state.selectedIds.delete(id));
            } else {
                item.ids.forEach(id => this.state.selectedIds.add(id));
            }
        } else {
            // Lógica Single
            if (this.state.selectedIds.has(item.id)) {
                this.state.selectedIds.delete(item.id);
            } else {
                this.state.selectedIds.add(item.id);
            }
        }
    }

    // Helper para saber si un bloque está visualmente seleccionado
    isBlockSelected(item) {
        if (item.type !== 'block') return false;
        // Consideramos seleccionado si TODOS sus items están en el set
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