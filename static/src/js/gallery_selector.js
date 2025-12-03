/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";

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

        // Cargar partners al iniciar el componente
        onWillStart(async () => {
            try {
                // CORRECCIÓN: Dominio vacío [] para traer todos los contactos sin filtrar por rango de cliente
                // Ordenamos por nombre para facilitar la búsqueda visual
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
            
            // Redirigir al registro creado
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
        this.state = useState({
            images: [],
            selectedIds: new Set(),
            search: ""
        });

        onWillStart(async () => {
            await this.loadImages();
        });
    }

    async loadImages(domain = []) {
        try {
            // Carga imágenes con info de Lote
            const fields = ["id", "name", "image_small", "lot_id"];
            // Asumimos que stock_lot_image tiene image_small del módulo anterior
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
        const val = ev.target.value;
        this.state.search = val;
        let domain = [];
        if (val) {
            domain = [['lot_id.name', 'ilike', val]];
        }
        await this.loadImages(domain);
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