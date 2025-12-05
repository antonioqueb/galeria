/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { useDebounced } from "@web/core/utils/timing";

// --- Componente Modal ---
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
        
        this.state = useState({
            images: [],
            categories: [],
            products: [],
            
            // Filtros
            selectedCategory: "",
            selectedProduct: "",
            filterBlock: "",
            filterBundle: "",
            search: "", // Lote
            
            selectedIds: new Set(),
            currentCompanyId: null,
            loading: false
        });

        // Debounce para inputs de texto (evita recargas excesivas)
        this.debouncedLoad = useDebounced(() => this.loadImages(), 500);

        onWillStart(async () => {
            try {
                // Obtener compañía de forma segura
                this.state.currentCompanyId = await this.orm.call("gallery.share", "get_current_company", []);
            } catch (e) { console.error("Error company:", e); }

            await this.loadCategories();
            await this.loadImages();
        });
    }

    async loadCategories() {
        // Buscar categoría padre "Placas" para limpiar el filtro
        try {
            const parent = await this.orm.searchRead("product.category", [['name', 'ilike', 'Placas']], ["id"], { limit: 1 });
            let domain = [];
            if (parent.length > 0) domain = [['parent_id', 'child_of', parent[0].id]];
            
            this.state.categories = await this.orm.searchRead("product.category", domain, ["id", "name"], { order: "name" });
        } catch (e) { console.error(e); }
    }

    async loadProducts() {
        const domain = [['sale_ok', '=', true]];
        if (this.state.selectedCategory) {
            domain.push(['categ_id', 'child_of', parseInt(this.state.selectedCategory)]);
        }
        this.state.products = await this.orm.searchRead("product.product", domain, ["id", "name", "default_code"], { limit: 100, order: "name" });
    }

    async loadImages() {
        this.state.loading = true;
        try {
            // ============================================================
            // PASO 1: BUSCAR QUANTS DISPONIBLES (Filtro Estricto)
            // ============================================================
            // Buscamos en el inventario físico qué lotes cumplen TODAS las reglas.
            // Aplicamos los filtros de texto aquí para aprovechar la indexación de stock.quant/stock.lot
            
            const quantDomain = [
                ['location_id.usage', '=', 'internal'],
                ['quantity', '>', 0],
                ['reserved_quantity', '=', 0],  // Sin reserva de sistema
                ['x_tiene_hold', '=', false]    // Sin apartado manual
            ];

            // Filtro Empresa
            if (this.state.currentCompanyId) {
                quantDomain.unshift(['company_id', '=', this.state.currentCompanyId]);
            }

            // Filtros de Usuario aplicados al Lote dentro del Quant
            if (this.state.search) { // Lote
                quantDomain.push(['lot_id.name', 'ilike', this.state.search]);
            }
            if (this.state.filterBlock) {
                quantDomain.push(['lot_id.x_bloque', 'ilike', this.state.filterBlock]);
            }
            if (this.state.filterBundle) {
                quantDomain.push(['lot_id.x_atado', 'ilike', this.state.filterBundle]);
            }
            if (this.state.selectedCategory) {
                quantDomain.push(['product_id.categ_id', 'child_of', parseInt(this.state.selectedCategory)]);
            }
            if (this.state.selectedProduct) {
                quantDomain.push(['product_id', '=', parseInt(this.state.selectedProduct)]);
            }

            // Obtenemos solo los IDs de lotes válidos
            const validQuants = await this.orm.searchRead(
                "stock.quant", 
                quantDomain, 
                ["lot_id"], 
                { limit: 200 } // Límite razonable para visualización
            );

            const validLotIds = validQuants.map(q => q.lot_id[0]);

            // Si no hay lotes disponibles, vaciamos y salimos
            if (validLotIds.length === 0) {
                this.state.images = [];
                this.state.loading = false;
                return;
            }

            // ============================================================
            // PASO 2: BUSCAR IMÁGENES DE ESOS LOTES
            // ============================================================
            this.state.images = await this.orm.searchRead(
                "stock.lot.image", 
                [['lot_id', 'in', validLotIds]], 
                ["id", "name", "image_small", "lot_id"], 
                { limit: 200, order: "id desc" }
            );

        } catch (e) {
            console.error("Error loading images:", e);
        } finally {
            this.state.loading = false;
        }
    }

    // --- Eventos ---
    async onCategoryChange(ev) {
        this.state.selectedCategory = ev.target.value;
        this.state.selectedProduct = "";
        await this.loadProducts();
        await this.loadImages();
    }

    async onProductChange(ev) {
        this.state.selectedProduct = ev.target.value;
        await this.loadImages();
    }

    onInputSearch(ev, field) {
        this.state[field] = ev.target.value;
        this.debouncedLoad();
    }

    toggleSelection(imgId) {
        if (this.state.selectedIds.has(imgId)) {
            this.state.selectedIds.delete(imgId);
        } else {
            this.state.selectedIds.add(imgId);
        }
    }

    selectAll() {
        this.state.images.forEach(img => this.state.selectedIds.add(img.id));
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