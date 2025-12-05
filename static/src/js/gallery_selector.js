/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { session } from "@web/session";

// Componente para el Modal de Crear Link
class CreateLinkDialog extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.action = useService("action");
        
        this.state = useState({
            partner_id: false,
            partners: []
        });

        onWillStart(async () => {
            try {
                this.state.partners = await this.orm.searchRead(
                    "res.partner", 
                    [], 
                    ["id", "name"], 
                    { limit: 80, order: "name asc" }
                );
            } catch (e) {
                console.error("Error cargando contactos:", e);
                this.state.partners = [];
            }
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
            this.notification.add("Error al crear el enlace: " + error.message, { type: "danger" });
        }
    }
}
CreateLinkDialog.template = "galeria.CreateLinkDialog";
CreateLinkDialog.components = { Dialog };

// Componente Principal: Dashboard Selector
export class GallerySelector extends Component {
    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        // CORRECCIÓN: Eliminamos la dependencia de useService("company") que causaba el error
        
        this.state = useState({
            images: [],
            categories: [],
            selectedCategory: null,
            selectedIds: new Set(),
            search: ""
        });

        onWillStart(async () => {
            await this.loadCategories();
            await this.loadImages();
        });
    }

    async loadCategories() {
        try {
            this.state.categories = await this.orm.searchRead(
                "product.category",
                [],
                ["id", "name"],
                { order: "name" }
            );
        } catch (e) {
            console.error("Error cargando categorías:", e);
        }
    }

    async loadImages() {
        try {
            // CORRECCIÓN: Usamos session directamente para obtener la compañía.
            // session.user_context.allowed_company_ids es un array, el [0] es la actual.
            const currentCompanyId = session.user_context.allowed_company_ids[0];

            // CONSTRUCCIÓN DEL DOMINIO DE DISPONIBILIDAD ESTRICTO
            const domain = [
                // 1. Filtrar por compañía actual explícitamente en el quant
                ['lot_id.quant_ids.company_id', '=', currentCompanyId],
                
                // 2. Ubicación Interna y Stock Físico
                ['lot_id.quant_ids.location_id.usage', '=', 'internal'],
                ['lot_id.quant_ids.quantity', '>', 0],
                
                // 3. Sin reservas de sistema (En orden de entrega)
                ['lot_id.quant_ids.reserved_quantity', '=', 0],
                
                // 4. Sin Hold Manual activo (Validación de disponibilidad real)
                ['lot_id.quant_ids.x_tiene_hold', '=', false]
            ];

            if (this.state.search) {
                domain.push(['lot_id.name', 'ilike', this.state.search]);
            }

            if (this.state.selectedCategory) {
                domain.push(['lot_id.product_id.categ_id', '=', parseInt(this.state.selectedCategory)]);
            }

            const fields = ["id", "name", "image_small", "lot_id"];
            
            this.state.images = await this.orm.searchRead(
                "stock.lot.image", 
                domain, 
                fields, 
                { limit: 100, order: "id desc" }
            );
        } catch (e) {
            console.error("Error cargando imágenes:", e);
        }
    }

    toggleSelection(imgId) {
        if (this.state.selectedIds.has(imgId)) {
            this.state.selectedIds.delete(imgId);
        } else {
            this.state.selectedIds.add(imgId);
        }
    }

    async onSearch(ev) {
        this.state.search = ev.target.value;
        await this.loadImages();
    }

    async onCategoryChange(ev) {
        this.state.selectedCategory = ev.target.value;
        await this.loadImages();
    }

    createLink() {
        if (this.state.selectedIds.size === 0) return;
        
        this.dialog.add(CreateLinkDialog, {
            selectedImages: Array.from(this.state.selectedIds),
            title: "Generar Enlace para Contacto"
        });
    }

    get isSomethingSelected() {
        return this.state.selectedIds.size > 0;
    }
}

GallerySelector.template = "galeria.GallerySelector";

registry.category("actions").add("galeria.selector_dashboard", GallerySelector);