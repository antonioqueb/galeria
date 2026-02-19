// static/src/js/gallery_public.js

class GalleryApp {
    constructor() {
        this.cart = [];
        this.config = {};
        this.cartKey = '';
        this.currentView = 'main';

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        this.config = window.galleryRawData || {};
        this.cartKey = 'stone_gallery_cart_' + (this.config.token || 'default');

        // Debug: verificar que los datos llegaron correctamente
        const blockCount = this.config.blocks_details ? Object.keys(this.config.blocks_details).length : 0;
        const initialViewCount = this.config.initial_view ? Object.keys(this.config.initial_view).length : 0;
        console.log('[Gallery] Config cargado. Categorías:', initialViewCount, '| Bloques con detalle:', blockCount);
        if (blockCount > 0) {
            console.log('[Gallery] IDs de bloques disponibles:', Object.keys(this.config.blocks_details));
        }

        const savedCart = localStorage.getItem(this.cartKey);
        if (savedCart) {
            try { this.cart = JSON.parse(savedCart); }
            catch (e) { this.cart = []; }
        }

        const container = document.getElementById('main-gallery-container');
        if (container) {
            this.mainGridHTML = container.innerHTML;
        }

        this.updateCartUI();
        this.updateButtonsState();
        this.bindEvents();
    }

    bindEvents() {
        document.body.addEventListener('click', (e) => {

            // A. Botón Abrir Bloque
            const openBlockBtn = e.target.closest('.open-block-btn');
            if (openBlockBtn) {
                e.preventDefault(); e.stopPropagation();
                const itemEl = openBlockBtn.closest('.bento-item');
                if (itemEl) this.openBlockView(itemEl.dataset.id);
                return;
            }

            // B. Lightbox
            const lightboxBtn = e.target.closest('.lightbox-trigger');
            if (lightboxBtn) {
                e.preventDefault(); e.stopPropagation();
                this.openLightbox(lightboxBtn);
                return;
            }

            // C. Botón Apartar
            const addBtn = e.target.closest('.btn-add-cart');
            if (addBtn) {
                e.preventDefault(); e.stopPropagation();
                this.handleAddToCartClick(addBtn);
                return;
            }

            // D. Clic en imagen
            const imgContainer = e.target.closest('.img-container');
            const isButtonInside = e.target.closest('button');
            if (imgContainer && !isButtonInside) {
                e.preventDefault(); e.stopPropagation();
                const itemEl = imgContainer.closest('.bento-item');
                if (itemEl) {
                    if (itemEl.dataset.type === 'block') {
                        this.openBlockView(itemEl.dataset.id);
                    } else {
                        this.openLightbox(imgContainer);
                    }
                }
                return;
            }

            // Volver
            if (e.target.closest('#btn-back-gallery')) {
                e.preventDefault();
                this.restoreMainView();
                return;
            }

            // Eliminar del carrito
            if (e.target.closest('.btn-remove')) {
                e.preventDefault();
                this.removeFromCart(e.target.closest('.btn-remove').dataset.id);
                return;
            }

            // Toggle carrito
            if (e.target.closest('#cart-toggle') || e.target.closest('.close-cart') || e.target.closest('#cart-overlay')) {
                e.preventDefault();
                this.toggleCart();
                return;
            }

            // Confirmar reserva
            if (e.target.closest('#btn-confirm')) {
                e.preventDefault();
                this.confirmReservation();
                return;
            }

            // Cerrar Lightbox
            if (e.target.closest('.close-lightbox')) {
                this.closeLightbox();
            }
        });
    }

    // --- VISTAS ---

    openBlockView(blockId) {
        console.log('[Gallery] Intentando abrir bloque:', blockId);
        console.log('[Gallery] blocks_details disponible:', this.config.blocks_details ? 'SÍ' : 'NO');

        const details = this.config.blocks_details ? this.config.blocks_details[blockId] : null;

        if (!details || details.length === 0) {
            console.error('[Gallery] No se encontraron detalles para el bloque:', blockId);
            console.log('[Gallery] Claves disponibles en blocks_details:', this.config.blocks_details ? Object.keys(this.config.blocks_details) : 'vacío');
            return;
        }

        console.log('[Gallery] Abriendo bloque con', details.length, 'placas');

        const container = document.getElementById('main-gallery-container');
        let html = `
            <div class="category-block">
                <h2 class="category-title text-primary">
                    <i class="fa fa-layer-group me-2"></i> Contenido del Bloque
                    <span class="line"></span>
                </h2>
                <div class="bento-grid">
        `;

        details.forEach(img => { html += this.renderCardHtml(img); });
        html += `</div></div>`;

        container.innerHTML = html;
        container.scrollIntoView({ behavior: 'smooth' });

        const backBtn = document.getElementById('btn-back-gallery');
        if (backBtn) backBtn.style.display = 'flex';

        this.currentView = 'block';
        this.updateButtonsState();
    }

    restoreMainView() {
        const container = document.getElementById('main-gallery-container');
        if (this.mainGridHTML) container.innerHTML = this.mainGridHTML;

        const backBtn = document.getElementById('btn-back-gallery');
        if (backBtn) backBtn.style.display = 'none';

        this.currentView = 'main';
        this.updateButtonsState();
    }

    renderCardHtml(img) {
        const areaVal = (typeof img.area === 'number') ? img.area.toFixed(2) : parseFloat(img.area || 0).toFixed(2);
        return `
            <div class="bento-item"
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
                            <span class="area-badge">${areaVal} m²</span>
                        </div>
                        <button class="btn-add-cart" type="button">Apartar</button>
                    </div>
                </div>
            </div>
        `;
    }

    // --- CARRITO ---

    handleAddToCartClick(btn) {
        const itemEl = btn.closest('.bento-item');
        if (!itemEl) return;

        const type = itemEl.dataset.type;
        const id = itemEl.dataset.id;

        if (type === 'block') {
            const details = this.config.blocks_details ? this.config.blocks_details[id] : [];
            if (!details || details.length === 0) return;

            const allIds = details.map(d => String(d.id));
            const inCartCount = this.cart.filter(c => allIds.includes(String(c.id))).length;

            if (inCartCount === details.length) {
                allIds.forEach(childId => this.removeFromCart(childId, false));
            } else {
                details.forEach(child => {
                    if (!this.cart.find(c => String(c.id) === String(child.id))) {
                        this.pushToCart({
                            id: child.id,
                            quant_id: child.quant_id,
                            name: child.name,
                            lot_name: child.lot_name,
                            dims: child.dimensions,
                            area: parseFloat(child.area),
                            url: child.url
                        });
                    }
                });
            }
            this.saveCart();

        } else {
            const existingIndex = this.cart.findIndex(i => String(i.id) === String(id));
            if (existingIndex > -1) {
                this.removeFromCart(id);
            } else {
                this.pushToCart({
                    id: id,
                    quant_id: itemEl.dataset.quantId,
                    name: itemEl.dataset.name,
                    lot_name: itemEl.dataset.lot,
                    dims: itemEl.dataset.dims,
                    area: parseFloat(itemEl.dataset.area || 0),
                    url: itemEl.dataset.url
                });
                this.saveCart();
            }
        }

        this.updateCartUI();
        this.updateButtonsState();
    }

    pushToCart(item) { this.cart.push(item); }

    removeFromCart(id, autoSave = true) {
        this.cart = this.cart.filter(item => String(item.id) !== String(id));
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
        const counter = document.getElementById('cart-count');
        const cartToggleBtn = document.getElementById('cart-toggle');
        if (counter) {
            counter.innerText = this.cart.length;
            counter.style.display = this.cart.length > 0 ? 'inline-block' : 'none';
        }
        if (cartToggleBtn) {
            this.cart.length > 0
                ? cartToggleBtn.classList.add('active-cart')
                : cartToggleBtn.classList.remove('active-cart');
        }

        document.querySelectorAll('.bento-item').forEach(el => {
            const btn = el.querySelector('.btn-add-cart');
            if (!btn) return;

            const type = el.dataset.type;
            const id = el.dataset.id;
            let isSelected = false;

            if (type === 'block') {
                const details = this.config.blocks_details ? this.config.blocks_details[id] : [];
                if (details && details.length > 0) {
                    const allIds = details.map(d => String(d.id));
                    const countInCart = this.cart.filter(c => allIds.includes(String(c.id))).length;
                    isSelected = (countInCart === details.length);
                }
            } else {
                isSelected = this.cart.some(i => String(i.id) === String(id));
            }

            if (isSelected) {
                btn.classList.add('in-cart');
                btn.textContent = 'Apartado';
            } else {
                btn.classList.remove('in-cart');
                btn.textContent = 'Apartar';
            }
        });
    }

    updateCartUI() {
        const container = document.getElementById('cart-items-container');
        if (!container) return;
        container.innerHTML = '';
        let totalArea = 0;

        if (this.cart.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:#666;padding:40px 20px;">
                    <i class="fa fa-shopping-basket fa-3x mb-3" style="opacity:0.3;"></i>
                    <p>Tu selección está vacía.</p>
                </div>`;
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
        if (totalAreaEl) totalAreaEl.innerText = totalArea.toFixed(2) + ' m²';

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
            img.style.transform = 'scale(1)';
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

    resetZoom() {
        const img = document.getElementById('lightbox-img');
        if (img) {
            img.style.transform = 'scale(1)';
            setTimeout(() => { img.style.transformOrigin = 'center center'; }, 300);
        }
    }

    zoomImage(e) {
        const img = document.getElementById('lightbox-img');
        if (!img) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * 100;
        const y = (e.clientY - rect.top) / rect.height * 100;
        img.style.transformOrigin = `${x}% ${y}%`;
        img.style.transform = 'scale(2.5)';
    }

    async confirmReservation() {
        if (this.cart.length === 0) return;

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 5);
        const expiryStr = expiryDate.toLocaleDateString('es-MX', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const disclaimer = document.createElement('div');
        disclaimer.id = 'reservation-disclaimer';
        disclaimer.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.88);z-index:9999;
            display:flex;align-items:center;justify-content:center;
            padding:20px;box-sizing:border-box;animation:fadeInOverlay 0.25s ease;
        `;
        disclaimer.innerHTML = `
            <style>
                @keyframes fadeInOverlay { from{opacity:0} to{opacity:1} }
                @keyframes slideUpModal { from{opacity:0;transform:translateY(30px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
                #disclaimer-box { animation:slideUpModal 0.3s ease forwards; }
                #disclaimer-confirm:hover { background:#e6c44a!important; box-shadow:0 4px 20px rgba(212,175,55,0.5); transform:translateY(-1px); }
                #disclaimer-cancel:hover { background:rgba(255,255,255,0.07)!important; border-color:#888!important; color:#fff!important; }
            </style>
            <div id="disclaimer-box" style="background:#1a1a1a;border:2px solid #d4af37;border-radius:14px;max-width:500px;width:100%;overflow:hidden;box-shadow:0 0 60px rgba(212,175,55,0.25),0 20px 60px rgba(0,0,0,0.6);">
                <div style="background:linear-gradient(135deg,#c9a227 0%,#e6c84a 50%,#c9a227 100%);padding:22px 28px 18px;text-align:center;">
                    <div style="font-size:2.8rem;line-height:1;margin-bottom:8px;">⏳</div>
                    <h2 style="margin:0;color:#1a1a00;font-size:1.15rem;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Aviso Importante</h2>
                    <p style="margin:4px 0 0;color:rgba(0,0,0,0.6);font-size:0.82rem;font-weight:600;">Condiciones del período de apartado</p>
                </div>
                <div style="padding:24px 28px 28px;">
                    <div style="background:rgba(212,175,55,0.07);border:1px solid rgba(212,175,55,0.25);border-left:5px solid #d4af37;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:18px;">
                        <p style="margin:0 0 10px;color:#fff;font-size:1.05rem;font-weight:700;line-height:1.5;">
                            Las placas seleccionadas quedarán
                            <span style="color:#d4af37;white-space:nowrap;">apartadas por 5 días calendario.</span>
                        </p>
                        <p style="margin:0;color:#b0b0b0;font-size:0.87rem;line-height:1.65;">
                            Vencimiento estimado: <strong style="color:#e0e0e0;">${expiryStr}</strong>
                        </p>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:12px;background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.25);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
                        <span style="font-size:1.4rem;flex-shrink:0;line-height:1;">⚠️</span>
                        <p style="margin:0;color:#c8a0a0;font-size:0.85rem;line-height:1.65;">
                            Al vencimiento, si no se ha formalizado la compra, <strong style="color:#e0a0a0;">las placas quedarán disponibles automáticamente</strong> para otros clientes, sin previo aviso.
                        </p>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:12px;background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 16px;margin-bottom:22px;">
                        <span style="font-size:1.2rem;flex-shrink:0;line-height:1;">📞</span>
                        <p style="margin:0;color:#888;font-size:0.82rem;line-height:1.65;">
                            Para formalizar tu compra, contacta a tu ejecutivo con la referencia que recibirás al confirmar.
                        </p>
                    </div>
                    <p style="text-align:center;font-size:0.76rem;color:#555;margin:0 0 20px;line-height:1.5;">
                        Al presionar <strong style="color:#888;">"Sí, Apartar Ahora"</strong> confirmas haber leído y aceptado las condiciones.
                    </p>
                    <div style="display:flex;gap:12px;">
                        <button id="disclaimer-cancel" type="button" style="flex:1;padding:13px 10px;background:transparent;border:1px solid #444;color:#888;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;transition:all 0.2s;">Cancelar</button>
                        <button id="disclaimer-confirm" type="button" style="flex:2;padding:13px 10px;background:#d4af37;border:none;color:#000;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;transition:all 0.25s;">✓ Sí, Apartar Ahora</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(disclaimer);
        document.body.style.overflow = 'hidden';

        const userConfirmed = await new Promise(resolve => {
            document.getElementById('disclaimer-cancel').addEventListener('click', () => resolve(false));
            document.getElementById('disclaimer-confirm').addEventListener('click', () => resolve(true));
            disclaimer.addEventListener('click', (e) => { if (e.target === disclaimer) resolve(false); });
        });

        document.body.removeChild(disclaimer);
        document.body.style.overflow = '';

        if (!userConfirmed) return;

        const btn = document.getElementById('btn-confirm');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Procesando...';
        btn.disabled = true;

        try {
            if (!this.config.token) throw new Error('Token no encontrado.');
            const response = await fetch('/gallery/confirm_reservation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', method: 'call',
                    params: { token: this.config.token, items: this.cart },
                    id: Math.floor(Math.random() * 1000)
                })
            });
            const result = await response.json();
            if (result.result && result.result.success) {
                alert('✅ ' + result.result.message + '\n\nReferencia: ' + result.result.order_name);
                this.cart = [];
                this.saveCart();
                this.updateCartUI();
                this.toggleCart();
                window.location.reload();
            } else {
                const msg = result.error
                    ? result.error.data.message
                    : (result.result ? result.result.message : 'Error desconocido');
                alert('⚠️ No se pudo reservar:\n' + msg);
            }
        } catch (error) {
            console.error(error);
            alert('Error de conexión.');
        } finally {
            if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
        }
    }
}

window.gallery = new GalleryApp();