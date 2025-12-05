/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart, onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { useDebounced } from "@web/core/utils/timing";

// --- Componente Modal (Sin cambios mayores, solo cosméticos) ---
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
            products: [], // Lista de productos filtrada
            
            // Filtros
            selectedCategory: "",
            selectedProduct: "",
            filterBlock: "",
            filterBundle: "",
            search: "", // Búsqueda general por lote
            
            selectedIds: new Set(),
            currentCompanyId: null,
            loading: false
        });

        // Crear versión debounced de la carga para inputs de texto
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
        this.state.categories = await this.orm.searchRead("product.category", [], ["id", "name"], { order: "name" });
    }

    async loadProducts() {
        // Cargar productos según la categoría seleccionada
        const domain = [('sale_ok', '=', true)];
        if (this.state.selectedCategory) {
            domain.push(['categ_id', 'child_of', parseInt(this.state.selectedCategory)]);
        }
        this.state.products = await this.orm.searchRead("product.product", domain, ["id", "name", "default_code"], { limit: 100, order: "name" });
    }

    async loadImages() {
        this.state.loading = true;
        try {
            // 1. Dominio Base (Disponibilidad)
            const domain = [
                ['lot_id.quant_ids.location_id.usage', '=', 'internal'],
                ['lot_id.quant_ids.quantity', '>', 0],
                ['lot_id.quant_ids.reserved_quantity', '=', 0],
                ['lot_id.quant_ids.x_tiene_hold', '=', false]
            ];

            if (this.state.currentCompanyId) {
                domain.unshift(['lot_id.quant_ids.company_id', '=', this.state.currentCompanyId]);
            }

            // 2. Filtros Dinámicos
            if (this.state.search) {
                domain.push(['lot_id.name', 'ilike', this.state.search]);
            }
            if (this.state.filterBlock) {
                domain.push(['lot_id.x_bloque', 'ilike', this.state.filterBlock]);
            }
            if (this.state.filterBundle) {
                domain.push(['lot_id.x_atado', 'ilike', this.state.filterBundle]);
            }
            if (this.state.selectedCategory) {
                domain.push(['lot_id.product_id.categ_id', 'child_of', parseInt(this.state.selectedCategory)]);
            }
            if (this.state.selectedProduct) {
                domain.push(['lot_id.product_id', '=', parseInt(this.state.selectedProduct)]);
            }

            // 3. Ejecutar búsqueda
            // Nota: No podemos obtener x_bloque directamente de stock.lot.image sin campos relacionados,
            // pero el filtro funciona. Para visualización usamos el nombre del lote.
            this.state.images = await this.orm.searchRead(
                "stock.lot.image", 
                domain, 
                ["id", "name", "image_small", "lot_id"], 
                { limit: 100, order: "id desc" }
            );
        } catch (e) {
            console.error("Error loading images:", e);
        } finally {
            this.state.loading = false;
        }
    }

    // --- Manejadores de Eventos ---

    async onCategoryChange(ev) {
        this.state.selectedCategory = ev.target.value;
        this.state.selectedProduct = ""; // Resetear producto
        await this.loadProducts();
        await this.loadImages();
    }

    async onProductChange(ev) {
        this.state.selectedProduct = ev.target.value;
        await this.loadImages();
    }

    onInputSearch(ev, field) {
        this.state[field] = ev.target.value;
        this.debouncedLoad(); // Usar debounce para no saturar
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