// static/src/js/gallery_public.js

class GalleryApp {
    constructor() {
        this.cart = [];
        // window.galleryRawData se inyecta desde el template
        this.config = window.galleryRawData || {};
        this.cartKey = 'stone_gallery_cart_' + (this.config.token || 'default');
        this.currentView = 'main'; // 'main' or 'block'
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        // Cargar carrito previo
        const savedCart = localStorage.getItem(this.cartKey);
        if (savedCart) {
            try {
                this.cart = JSON.parse(savedCart);
            } catch (e) {
                this.cart = [];
            }
        }
        
        // Guardar el HTML inicial del grid para restaurarlo rápido al volver
        this.mainGridHTML = document.getElementById('main-gallery-container').innerHTML;

        this.updateCartUI();
        this.updateButtonsState();
        this.bindEvents();
    }

    bindEvents() {
        document.body.addEventListener('click', (e) => {
            // 1. Botón Abrir Bloque (Carpeta o Click en imagen de bloque)
            const openBlockBtn = e.target.closest('.open-block-btn');
            if (openBlockBtn) {
                e.preventDefault(); e.stopPropagation();
                const itemEl = openBlockBtn.closest('.bento-item');
                this.openBlockView(itemEl.dataset.id);
                return;
            }

            // 2. Lightbox (Solo para imágenes simples)
            const lightboxBtn = e.target.closest('.lightbox-trigger');
            if (lightboxBtn) {
                e.preventDefault(); e.stopPropagation(); 
                this.openLightbox(lightboxBtn);
                return;
            }

            // 3. Agregar al Carrito
            const addBtn = e.target.closest('.btn-add-cart');
            if (addBtn) {
                e.preventDefault(); e.stopPropagation();
                this.handleAddToCartClick(addBtn);
                return;
            }

            // 4. Volver a galería principal
            if (e.target.closest('#btn-back-gallery')) {
                e.preventDefault();
                this.restoreMainView();
                return;
            }

            // 5. Carrito UI (Toggle, Remove, Close)
            if (e.target.closest('.btn-remove')) {
                e.preventDefault();
                this.removeFromCart(e.target.closest('.btn-remove').dataset.id);
                return;
            }
            if (e.target.closest('#cart-toggle') || e.target.closest('.close-cart') || e.target.closest('#cart-overlay')) {
                e.preventDefault();
                this.toggleCart();
                return;
            }

            // 6. Checkout
            if (e.target.closest('#btn-confirm')) {
                e.preventDefault();
                this.confirmReservation();
                return;
            }

            // 7. Close Lightbox
            if (e.target.closest('.close-lightbox')) {
                this.closeLightbox();
            }
        });
    }

    // --- Lógica de Vistas (Bloque vs Main) ---

    openBlockView(blockId) {
        const details = this.config.blocks_details ? this.config.blocks_details[blockId] : null;
        if (!details || details.length === 0) return;

        const container = document.getElementById('main-gallery-container');
        
        // Generar HTML para los items internos
        let html = `
            <div class="category-block">
                <h2 class="category-title text-primary">
                    <i class="fa fa-layer-group me-2"></i> Contenido del Bloque
                    <span class="line"></span>
                </h2>
                <div class="bento-grid">
        `;

        details.forEach(img => {
            html += this.renderCardHtml(img, false);
        });

        html += `</div></div>`;
        
        container.innerHTML = html;
        container.scrollIntoView({ behavior: 'smooth' });

        // Mostrar botón volver
        const backBtn = document.getElementById('btn-back-gallery');
        if (backBtn) backBtn.style.display = 'flex'; // flex para alinear icono

        this.currentView = 'block';
        this.updateButtonsState();
    }

    restoreMainView() {
        const container = document.getElementById('main-gallery-container');
        container.innerHTML = this.mainGridHTML;
        
        const backBtn = document.getElementById('btn-back-gallery');
        if (backBtn) backBtn.style.display = 'none';

        this.currentView = 'main';
        this.updateButtonsState();
    }

    renderCardHtml(img, isBlock) {
        // Reutilizamos estructura del template para generar HTML dinámico
        const isLarge = false; // Dentro del bloque, mostramos todo regular para uniformidad
        return `
            <div class="bento-item ${isLarge ? 'bento-large' : ''}"
                 data-id="${img.id}"
                 data-type="single"
                 data-quant-id="${img.quant_id}"
                 data-name="${img.name}"
                 data-lot="${img.lot_name}"
                 data-dims="${img.dimensions}"
                 data-area="${img.area}"
                 data-url="${img.url}">
                
                <div class="bento-card">
                    <div class="img-container">
                        <img src="${img.url}" loading="lazy" alt="${img.lot_name}"/>
                        <div class="card-actions">
                            <button class="btn-expand lightbox-trigger" type="button">
                                <i class="fa fa-expand"></i>
                            </button>
                        </div>
                    </div>
                    <div class="card-footer">
                        <div class="info-text">
                            <span class="product-name">${img.name}</span>
                            <div class="meta">
                                <span class="lot">${img.lot_name}</span>
                                <span class="sep">•</span>
                                <span class="dims">${img.dimensions}</span>
                            </div>
                            <span class="area-badge">${img.area.toFixed(2)} m²</span>
                        </div>
                        <button class="btn-add-cart" type="button">
                            <i class="fa fa-plus"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // --- Lógica del Carrito ---

    handleAddToCartClick(btn) {
        const itemEl = btn.closest('.bento-item');
        if (!itemEl) return;

        const type = itemEl.dataset.type;
        const id = itemEl.dataset.id;

        // Si es un BLOQUE -> Agregamos todos sus hijos
        if (type === 'block') {
            const details = this.config.blocks_details ? this.config.blocks_details[id] : [];
            
            // Verificar si el bloque ya está "lleno" en el carrito
            // Simplificación: Si alguno falta, agregamos los que faltan. Si todos están, los quitamos todos.
            const allIds = details.map(d => String(d.id));
            const inCartCount = this.cart.filter(c => allIds.includes(String(c.id))).length;
            
            if (inCartCount === details.length) {
                // Todos están -> Quitarlos (Toggle off)
                allIds.forEach(childId => this.removeFromCart(childId, false));
                this.saveCart();
            } else {
                // Faltan algunos -> Agregar los que falten
                details.forEach(child => {
                    if (!this.cart.find(c => String(c.id) === String(child.id))) {
                        this.pushToCart(child);
                    }
                });
                this.saveCart();
            }

        } else {
            // Es item simple
            const existingIndex = this.cart.findIndex(i => String(i.id) === String(id));
            if (existingIndex > -1) {
                this.removeFromCart(id);
            } else {
                const product = {
                    id: id,
                    quant_id: itemEl.dataset.quantId,
                    name: itemEl.dataset.name,
                    lot_name: itemEl.dataset.lot,
                    dims: itemEl.dataset.dims,
                    area: parseFloat(itemEl.dataset.area || 0),
                    url: itemEl.dataset.url
                };
                this.pushToCart(product);
                this.saveCart();
            }
        }

        this.updateCartUI();
        this.updateButtonsState();
    }

    pushToCart(item) {
        // Asegurar estructura
        this.cart.push({
            id: item.id,
            quant_id: item.quant_id,
            name: item.name || item.product_name,
            lot_name: item.lot_name,
            dims: item.dimensions,
            area: parseFloat(item.area || 0),
            url: item.url
        });
    }

    removeFromCart(id, autoSave = true) {
        const strId = String(id);
        this.cart = this.cart.filter(item => String(item.id) !== strId);
        if (autoSave) {
            this.saveCart();
            this.updateCartUI();
            this.updateButtonsState();
        }
    }

    saveCart() {
        localStorage.setItem(this.cartKey, JSON.stringify(this.cart));
    }

    updateButtonsState() {
        // 1. Header Count
        const counter = document.getElementById('cart-count');
        const cartToggleBtn = document.getElementById('cart-toggle');
        if (counter) {
            counter.innerText = this.cart.length;
            counter.style.display = this.cart.length > 0 ? 'inline-block' : 'none';
        }
        if (cartToggleBtn) {
            this.cart.length > 0 ? cartToggleBtn.classList.add('active-cart') : cartToggleBtn.classList.remove('active-cart');
        }

        // 2. Grid Buttons
        document.querySelectorAll('.bento-item').forEach(el => {
            const btn = el.querySelector('.btn-add-cart');
            const icon = btn.querySelector('i');
            const type = el.dataset.type;
            const id = el.dataset.id;

            let isSelected = false;

            if (type === 'block') {
                // Lógica visual para bloque: ¿Están todos sus hijos en el carrito?
                const details = this.config.blocks_details ? this.config.blocks_details[id] : [];
                if (details.length > 0) {
                    const allIds = details.map(d => String(d.id));
                    const countInCart = this.cart.filter(c => allIds.includes(String(c.id))).length;
                    isSelected = (countInCart === details.length);
                    
                    // Estado parcial (opcional): podriamos poner otro color si faltan algunos
                }
            } else {
                isSelected = this.cart.some(i => String(i.id) === String(id));
            }

            if (isSelected) {
                btn.classList.add('in-cart');
                if (icon) { icon.classList.remove('fa-plus'); icon.classList.add('fa-check'); }
            } else {
                btn.classList.remove('in-cart');
                if (icon) { icon.classList.remove('fa-check'); icon.classList.add('fa-plus'); }
            }
        });
    }

    // ... (El resto de métodos updateCartUI, toggleCart, Lightbox y confirmReservation permanecen igual) ...
    
    updateCartUI() {
        const container = document.getElementById('cart-items-container');
        if (!container) return;

        container.innerHTML = '';
        let totalArea = 0;

        if (this.cart.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #666; padding: 40px 20px;">
                    <i class="fa fa-shopping-basket fa-3x mb-3" style="opacity: 0.3;"></i>
                    <p>Tu selección está vacía.</p>
                </div>
            `;
        } else {
            this.cart.forEach(item => {
                totalArea += item.area;
                const div = document.createElement('div');
                div.className = 'cart-item';
                div.innerHTML = `
                    <img src="${item.url}" alt="Thumbnail"/>
                    <div class="item-details">
                        <h4>${item.name}</h4>
                        <p>Lote: <strong>${item.lot_name}</strong></p>
                        <p class="small">${item.dims} | ${item.area.toFixed(2)} m²</p>
                    </div>
                    <button class="btn-remove" type="button" data-id="${item.id}">
                        <i class="fa fa-times"></i>
                    </button>
                `;
                container.appendChild(div);
            });
        }

        const totalPlatesEl = document.getElementById('total-plates');
        const totalAreaEl = document.getElementById('total-area');
        
        if (totalPlatesEl) totalPlatesEl.innerText = this.cart.length;
        if (totalAreaEl) totalAreaEl.innerText = totalArea.toFixed(2) + " m²";
        
        const confirmBtn = document.getElementById('btn-confirm');
        if (confirmBtn) {
            confirmBtn.disabled = this.cart.length === 0;
            confirmBtn.style.opacity = this.cart.length === 0 ? '0.5' : '1';
            confirmBtn.style.cursor = this.cart.length === 0 ? 'not-allowed' : 'pointer';
        }
    }
    
    toggleCart() {
        const sidebar = document.getElementById('cart-sidebar');
        const overlay = document.getElementById('cart-overlay');
        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
        }
    }

    openLightbox(btn) {
        const itemEl = btn.closest('.bento-item');
        if (!itemEl) return;
        const imgUrl = itemEl.dataset.url;
        const lightbox = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        if (lightbox && img) {
            img.style.transform = "scale(1)";
            img.src = imgUrl;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    closeLightbox() {
        const lightbox = document.getElementById('lightbox');
        if (lightbox) {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
            this.resetZoom();
        }
    }

    zoomImage(e) {
        const img = document.getElementById('lightbox-img');
        if (!img) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * 100;
        const y = (e.clientY - rect.top) / rect.height * 100;
        img.style.transformOrigin = `${x}% ${y}%`;
        img.style.transform = "scale(2.5)";
    }

    resetZoom() {
        const img = document.getElementById('lightbox-img');
        if (img) {
            img.style.transform = "scale(1)";
            setTimeout(() => { img.style.transformOrigin = "center center"; }, 300);
        }
    }

    async confirmReservation() {
        if (this.cart.length === 0) return;
        const btn = document.getElementById('btn-confirm');
        const originalText = btn.innerText;
        btn.innerText = "Procesando...";
        btn.disabled = true;

        try {
            if (!this.config.token) throw new Error("Token no encontrado.");

            const response = await fetch('/gallery/confirm_reservation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: { token: this.config.token, items: this.cart },
                    id: Math.floor(Math.random() * 1000)
                })
            });

            const result = await response.json();
            if (result.result && result.result.success) {
                alert("✅ " + result.result.message + "\n\nReferencia: " + result.result.order_name);
                this.cart = [];
                this.saveCart();
                this.updateCartUI();
                this.toggleCart();
                window.location.reload();
            } else {
                const msg = result.error ? result.error.data.message : (result.result ? result.result.message : "Error desconocido");
                alert("⚠️ No se pudo reservar:\n" + msg);
            }
        } catch (error) {
            console.error(error);
            alert("Error de conexión.");
        } finally {
            if (btn) { btn.innerText = originalText; btn.disabled = false; }
        }
    }
}

window.gallery = new GalleryApp();3