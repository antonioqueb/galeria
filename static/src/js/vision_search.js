/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart, useRef } from "@odoo/owl";
import { useService, useExternalListener } from "@web/core/utils/hooks";
// Odoo 19: rpc dejó de ser un servicio de useService y se importa directo.
import { rpc } from "@web/core/network/rpc";

/**
 * Buscador visual de materiales.
 *
 * Dos formas de buscar contra el mismo índice:
 *   · Palabras  — "mármol blanco con vetas grises"
 *   · Imagen    — arrastras una foto y devuelve los materiales parecidos
 *
 * El parecido se muestra RELATIVO al mejor resultado, no en absoluto: CLIP
 * da valores muy distintos comparando texto (~0.3) que imagen (~0.8), y un
 * "28%" en una búsqueda correcta se leería como un mal resultado.
 */
export class VisionSearch extends Component {
    static template = "galeria.VisionSearch";
    // Odoo inyecta props propias a las acciones de cliente (action, actionId,
    // className, globalState...). Con props = {} OWL las rechaza y el
    // componente falla al renderizar.
    static props = ["*"];

    setup() {
        this.notification = useService("notification");
        this.fileInput = useRef("fileInput");

        this.state = useState({
            consulta: "",
            resultados: [],
            cargando: false,
            buscado: false,
            arrastrando: false,
            miniatura: null,
            visor: null,
            indexadas: null,
            error: null,
        });

        // Escape cierra el visor: es lo que espera cualquiera con una foto
        // abierta a pantalla completa.
        useExternalListener(window, "keydown", (ev) => {
            if (ev.key === "Escape" && this.state.visor) {
                this.cerrarVisor();
            }
        });

        onWillStart(async () => {
            const estado = await rpc("/som_vision/estado", {});
            if (estado.ok) {
                this.state.indexadas = estado.fotos_indexadas;
            } else {
                this.state.error = estado.error;
            }
        });
    }

    async buscarTexto() {
        const q = this.state.consulta.trim();
        if (q.length < 2) {
            return;
        }
        this.state.cargando = true;
        this.state.error = null;
        this.state.miniatura = null;
        try {
            const res = await rpc("/som_vision/buscar_texto", { q, limite: 24 });
            this._recibir(res);
        } finally {
            this.state.cargando = false;
            this.state.buscado = true;
        }
    }

    onKeydown(ev) {
        if (ev.key === "Enter") {
            this.buscarTexto();
        }
    }

    abrirSelector() {
        this.fileInput.el.click();
    }

    onFileChange(ev) {
        const archivo = ev.target.files[0];
        if (archivo) {
            this.buscarImagen(archivo);
        }
    }

    onDragOver(ev) {
        ev.preventDefault();
        this.state.arrastrando = true;
    }

    onDragLeave() {
        this.state.arrastrando = false;
    }

    onDrop(ev) {
        ev.preventDefault();
        this.state.arrastrando = false;
        const archivo = ev.dataTransfer.files[0];
        if (archivo) {
            this.buscarImagen(archivo);
        }
    }

    async buscarImagen(archivo) {
        if (!archivo.type.startsWith("image/")) {
            this.notification.add("Ese archivo no es una imagen", { type: "warning" });
            return;
        }
        this.state.cargando = true;
        this.state.error = null;
        this.state.consulta = "";
        // Miniatura local para que se vea CON QUÉ se está buscando.
        this.state.miniatura = URL.createObjectURL(archivo);

        const datos = new FormData();
        datos.append("foto", archivo);
        datos.append("limite", "24");
        // Odoo protege con CSRF todas las rutas POST de tipo http. Sin este
        // token la peticion se rechaza con 400 antes de llegar al controlador.
        // Se manda el token en vez de desactivar la proteccion con csrf=False.
        datos.append("csrf_token", odoo.csrf_token);
        try {
            const resp = await fetch("/som_vision/buscar_imagen", {
                method: "POST",
                body: datos,
            });
            this._recibir(await resp.json());
        } catch {
            this.state.error = "No se pudo procesar la imagen";
        } finally {
            this.state.cargando = false;
            this.state.buscado = true;
        }
    }

    _recibir(res) {
        if (res && res.ok) {
            this.state.resultados = res.resultados || [];
            this.state.error = null;
        } else {
            this.state.resultados = [];
            this.state.error = (res && res.error) || "La búsqueda falló";
        }
    }

    abrirVisor(resultado) {
        this.state.visor = resultado;
    }

    cerrarVisor() {
        this.state.visor = null;
    }

    ejemplo(texto) {
        this.state.consulta = texto;
        this.buscarTexto();
    }
}

registry.category("actions").add("galeria.vision_search", VisionSearch);
