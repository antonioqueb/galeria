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

        const blockCount = this.config.blocks_details ? Object.keys(this.config.blocks_details).length : 0;
        const initialViewCount = this.config.initial_view ? Object.keys(this.config.initial_view).length : 0;
        console.log('[Gallery] Categorías:', initialViewCount, '| Bloques agrupados:', blockCount, '| Placas totales:', this.config.total_pieces);

        const savedCart = localStorage.getItem(this.cartKey);
        if (savedCart) {
            try {
                this.cart = JSON.parse(savedCart);
            } catch (e) {
                this.cart = [];
            }
        }

        const container = document.getElementById('main-gallery-container');
        if (container) {
            this.mainGridHTML = container.innerHTML;
        }

        this.bindEvents();
        this.updateCartUI();
        this.updateButtonsState();
        this.updateSelectionStates();
        this.animateOnScroll();
    }

    bindEvents() {
        document.body.addEventListener('click', (e) => {

            // A. Botón Abrir Bloque
            const openBlockBtn = e.target.closest('.open-block-btn');
            if (openBlockBtn) {
                e.preventDefault();
                e.stopPropagation();

                const itemEl = openBlockBtn.closest('.bento-item');
                if (itemEl) {
                    this.openBlockView(itemEl.dataset.id, itemEl.dataset.lot);
                }
                return;
            }

            // B. Lightbox
            const lightboxBtn = e.target.closest('.lightbox-trigger');
            if (lightboxBtn) {
                e.preventDefault();
                e.stopPropagation();

                this.openLightbox(lightboxBtn);
                return;
            }

            // C. Botón Apartar
            const addBtn = e.target.closest('.btn-add-cart');
            if (addBtn) {
                e.preventDefault();
                e.stopPropagation();

                this.handleAddToCartClick(addBtn);
                return;
            }

            // D. Click directo en imagen/card
            const imgContainer = e.target.closest('.img-container');
            const isButtonInside = e.target.closest('button');

            if (imgContainer && !isButtonInside) {
                e.preventDefault();
                e.stopPropagation();

                const itemEl = imgContainer.closest('.bento-item');
                if (itemEl) {
                    if (itemEl.dataset.type === 'block') {
                        this.openBlockView(itemEl.dataset.id, itemEl.dataset.lot);
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
            const removeBtn = e.target.closest('.btn-remove');
            if (removeBtn) {
                e.preventDefault();
                this.removeFromCart(removeBtn.dataset.id);
                return;
            }

            // Toggle carrito
            if (
                e.target.closest('#cart-toggle') ||
                e.target.closest('#sticky-open-cart') ||
                e.target.closest('.close-cart') ||
                e.target.closest('#cart-overlay')
            ) {
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

        // ESC para cerrar lightbox/carrito
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (document.getElementById('lightbox')?.classList.contains('active')) {
                    this.closeLightbox();
                } else if (document.getElementById('cart-sidebar')?.classList.contains('open')) {
                    this.toggleCart();
                }
            }
        });
    }

    // =========================================================
    // Seguridad / helpers
    // =========================================================

    escapeHtml(value) {
        // No usar replaceAll(): puede romper compatibilidad en algunos bundles/navegadores.
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    openWhatsApp(url) {
        if (!url) return false;

        try {
            const opened = window.open(url, '_blank');
            if (opened) {
                try {
                    opened.opener = null;
                } catch (error) {
                    // Algunos navegadores bloquean acceso a opener.
                }

                try {
                    opened.focus();
                } catch (error) {
                    // Algunos navegadores bloquean focus().
                }

                return true;
            }
        } catch (error) {
            console.warn('[Gallery] WhatsApp popup bloqueado, abriendo en misma pestaña.', error);
        }

        window.location.href = url;
        return false;
    }

    // =========================================================
    // Vistas
    // =========================================================

    openBlockView(blockId, blockLot) {
        const details = this.config.blocks_details ? this.config.blocks_details[blockId] : null;

        if (!details || details.length === 0) {
            this.showToast('No se pudo cargar el bloque', 'error');
            return;
        }

        const blockLabel = blockLot ? `#${blockLot}` : `#${blockId}`;
        const container = document.getElementById('main-gallery-container');

        if (!container) {
            this.showToast('No se encontró el contenedor de la galería', 'error');
            return;
        }

        let html = `
            <div class="category-block">
                <h2 class="category-title">
                    <span class="cat-name">${this.escapeHtml(blockLabel)}</span>
                    <span class="cat-count">${details.length} placas</span>
                    <span class="line"></span>
                </h2>
                <div class="bento-grid">
        `;

        details.forEach(img => {
            html += this.renderCardHtml(img);
        });

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;

        const backBtn = document.getElementById('btn-back-gallery');
        if (backBtn) {
            backBtn.style.display = 'flex';
        }

        this.currentView = 'block';
        this.updateButtonsState();
        this.updateSelectionStates();

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    restoreMainView() {
        const container = document.getElementById('main-gallery-container');

        if (container && this.mainGridHTML) {
            container.innerHTML = this.mainGridHTML;
        }

        const backBtn = document.getElementById('btn-back-gallery');
        if (backBtn) {
            backBtn.style.display = 'none';
        }

        this.currentView = 'main';
        this.updateButtonsState();
        this.updateSelectionStates();

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderCardHtml(img) {
        const areaVal = (typeof img.area === 'number')
            ? img.area.toFixed(2)
            : parseFloat(img.area || 0).toFixed(2);

        const safeId = this.escapeHtml(img.id);
        const safeQuantId = this.escapeHtml(img.quant_id);
        const safeLotId = this.escapeHtml(img.lot_id);
        const safeName = this.escapeHtml(img.name);
        const safeLotName = this.escapeHtml(img.lot_name);
        const safeDims = this.escapeHtml(img.dimensions);
        const safeArea = this.escapeHtml(img.area);
        const safeUrl = this.escapeHtml(img.url);

        return `
            <div class="bento-item"
                 data-id="${safeId}"
                 data-type="single"
                 data-quant-id="${safeQuantId}"
                 data-lot-id="${safeLotId}"
                 data-name="${safeName}"
                 data-lot="${safeLotName}"
                 data-dims="${safeDims}"
                 data-area="${safeArea}"
                 data-url="${safeUrl}">

                <div class="bento-card">
                    <div class="img-container">
                        <img src="${safeUrl}" loading="lazy" alt="${safeLotName}"/>
                        <div class="selection-indicator">
                            <i class="fa fa-check"></i>
                        </div>

                        <div class="card-actions">
                            <button class="btn-expand lightbox-trigger" type="button" title="Ampliar">
                                <i class="fa fa-expand"></i>
                            </button>
                        </div>

                        <span class="unique-badge">
                            <i class="fa fa-gem"></i>Lote único
                        </span>
                    </div>

                    <div class="card-footer">
                        <div class="info-text">
                            <span class="product-name">${safeName}</span>
                            <div class="meta">
                                <span class="lot">${safeLotName}</span>
                                <span class="sep">·</span>
                                <span class="dims">${safeDims}</span>
                            </div>
                            <span class="area-badge">${areaVal} m²</span>
                        </div>

                        <button class="btn-add-cart" type="button">
                            <i class="fa fa-plus"></i>
                            <span>Apartar</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // =========================================================
    // Carrito
    // =========================================================

    handleAddToCartClick(btn) {
        const itemEl = btn.closest('.bento-item');
        if (!itemEl) return;

        const type = itemEl.dataset.type;
        const id = itemEl.dataset.id;

        if (type === 'block') {
            const details = this.config.blocks_details ? this.config.blocks_details[id] : [];

            if (!details || details.length === 0) {
                this.showToast('No se pudo cargar el bloque', 'error');
                return;
            }

            const allIds = details.map(d => String(d.id));
            const inCartCount = this.cart.filter(c => allIds.includes(String(c.id))).length;

            if (inCartCount === details.length) {
                allIds.forEach(childId => this.removeFromCart(childId, false));
                this.saveCart();
                this.showToast(`Bloque liberado (${details.length} placas)`, 'warning');
            } else {
                let added = 0;

                details.forEach(child => {
                    if (!this.cart.find(c => String(c.id) === String(child.id))) {
                        this.pushToCart({
                            id: child.id,
                            quant_id: child.quant_id,
                            lot_id: child.lot_id,
                            name: child.name,
                            lot_name: child.lot_name,
                            dims: child.dimensions,
                            area: parseFloat(child.area || 0),
                            url: child.url
                        });
                        added++;
                    }
                });

                this.saveCart();
                this.showToast(`+${added} placas apartadas del bloque`, 'success');
            }
        } else {
            const existingIndex = this.cart.findIndex(i => String(i.id) === String(id));

            if (existingIndex > -1) {
                this.removeFromCart(id);
            } else {
                this.pushToCart({
                    id: id,
                    quant_id: itemEl.dataset.quantId,
                    lot_id: itemEl.dataset.lotId,
                    name: itemEl.dataset.name,
                    lot_name: itemEl.dataset.lot,
                    dims: itemEl.dataset.dims,
                    area: parseFloat(itemEl.dataset.area || 0),
                    url: itemEl.dataset.url
                });

                this.saveCart();
                this.showToast('Placa apartada', 'success');
            }
        }

        this.updateCartUI();
        this.updateButtonsState();
        this.updateSelectionStates();
    }

    pushToCart(item) {
        this.cart.push(item);
    }

    removeFromCart(id, autoSave = true) {
        this.cart = this.cart.filter(item => String(item.id) !== String(id));

        if (autoSave) {
            this.saveCart();
            this.updateCartUI();
            this.updateButtonsState();
            this.updateSelectionStates();
        }
    }

    saveCart() {
        try {
            localStorage.setItem(this.cartKey, JSON.stringify(this.cart));
        } catch (error) {
            console.warn('[Gallery] No se pudo guardar el carrito en localStorage.', error);
        }
    }

    updateButtonsState() {
        const counter = document.getElementById('cart-count');
        const cartToggleBtn = document.getElementById('cart-toggle');

        if (counter) {
            counter.innerText = this.cart.length;
            counter.style.display = this.cart.length > 0 ? 'inline-block' : 'none';
        }

        if (cartToggleBtn) {
            if (this.cart.length > 0) {
                cartToggleBtn.classList.add('active-cart');
            } else {
                cartToggleBtn.classList.remove('active-cart');
            }
        }

        const stickyBar = document.getElementById('sticky-cart-bar');
        if (stickyBar) {
            stickyBar.classList.add('visible');
            stickyBar.classList.toggle('is-empty', this.cart.length === 0);

            const totalArea = this.cart.reduce((s, i) => s + (i.area || 0), 0);
            const sCount = document.getElementById('sticky-count');
            const sArea = document.getElementById('sticky-area');

            if (sCount) sCount.textContent = this.cart.length;
            if (sArea) sArea.textContent = totalArea.toFixed(2);
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
                    isSelected = countInCart === details.length;
                }
            } else {
                isSelected = this.cart.some(i => String(i.id) === String(id));
            }

            const labelSpan = btn.querySelector('span');
            const icon = btn.querySelector('i');

            if (icon) icon.className = 'fa fa-check';

            if (isSelected) {
                btn.classList.add('in-cart');
                if (labelSpan) labelSpan.textContent = type === 'block' ? 'Bloque apartado' : 'Apartado';
                btn.setAttribute('aria-label', type === 'block' ? 'Bloque apartado' : 'Apartado');
            } else {
                btn.classList.remove('in-cart');
                if (labelSpan) labelSpan.textContent = type === 'block' ? 'Apartar bloque' : 'Apartar';
                btn.setAttribute('aria-label', type === 'block' ? 'Apartar bloque' : 'Apartar');
            }
        });
    }

    updateSelectionStates() {
        document.querySelectorAll('.bento-item').forEach(el => {
            const type = el.dataset.type;
            const id = el.dataset.id;
            let isSelected = false;

            if (type === 'block') {
                const details = this.config.blocks_details ? this.config.blocks_details[id] : [];

                if (details && details.length > 0) {
                    const allIds = details.map(d => String(d.id));
                    const countInCart = this.cart.filter(c => allIds.includes(String(c.id))).length;
                    isSelected = countInCart === details.length;
                }
            } else {
                isSelected = this.cart.some(i => String(i.id) === String(id));
            }

            el.classList.toggle('is-selected', isSelected);
        });
    }

    updateCartUI() {
        const container = document.getElementById('cart-items-container');
        if (!container) return;

        container.innerHTML = '';

        let totalArea = 0;

        if (this.cart.length === 0) {
            container.innerHTML = `
                <div class="cart-empty">
                    <i class="fa fa-gem"></i>
                    <p>Tu selección está vacía</p>
                    <small>Apartar placas no compromete su compra</small>
                </div>
            `;
        } else {
            this.cart.forEach(item => {
                totalArea += item.area || 0;

                const safeUrl = this.escapeHtml(item.url);
                const safeName = this.escapeHtml(item.name);
                const safeLotName = this.escapeHtml(item.lot_name);
                const safeDims = this.escapeHtml(item.dims);
                const safeId = this.escapeHtml(item.id);

                const div = document.createElement('div');
                div.className = 'cart-item';
                div.innerHTML = `
                    <img src="${safeUrl}" alt="Thumbnail"/>
                    <div class="item-details">
                        <h4>${safeName}</h4>
                        <div class="lot-pill">${safeLotName}</div>
                        <div class="item-meta">
                            ${safeDims ? safeDims + ' · ' : ''}
                            <span class="area">${(item.area || 0).toFixed(2)} m²</span>
                        </div>
                    </div>
                    <button class="btn-remove" type="button" data-id="${safeId}" title="Quitar">
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
        }
    }

    toggleCart() {
        const sidebar = document.getElementById('cart-sidebar');
        const overlay = document.getElementById('cart-overlay');

        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
            document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
        }
    }

    // =========================================================
    // Lightbox
    // =========================================================

    openLightbox(btn) {
        const itemEl = btn.closest('.bento-item');
        if (!itemEl) return;

        const imgUrl = itemEl.dataset.url;
        const lightbox = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');

        const infoName = document.getElementById('lb-info-name');
        const infoLot = document.getElementById('lb-info-lot');
        const infoDims = document.getElementById('lb-info-dims');
        const infoArea = document.getElementById('lb-info-area');

        if (infoName) infoName.textContent = itemEl.dataset.name || '';
        if (infoLot) infoLot.textContent = itemEl.dataset.lot || '';
        if (infoDims) infoDims.textContent = itemEl.dataset.dims || '';

        const areaVal = parseFloat(itemEl.dataset.area || 0).toFixed(2);
        if (infoArea) infoArea.textContent = areaVal + ' m²';

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
            setTimeout(() => {
                img.style.transformOrigin = 'center center';
            }, 300);
        }
    }

    zoomImage(e) {
        const img = document.getElementById('lightbox-img');
        if (!img) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        img.style.transformOrigin = `${x}% ${y}%`;
        img.style.transform = 'scale(2.4)';
    }

    // =========================================================
    // UI helpers
    // =========================================================

    showToast(message, type = 'info') {
        let toast = document.getElementById('gallery-toast');

        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'gallery-toast';
            toast.className = 'gallery-toast';
            document.body.appendChild(toast);
        }

        const iconMap = {
            success: 'fa-check-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle',
            info: 'fa-info-circle'
        };

        toast.className = `gallery-toast ${type}`;
        toast.innerHTML = `
            <i class="fa ${iconMap[type] || iconMap.info}"></i>
            <span>${this.escapeHtml(message)}</span>
        `;

        clearTimeout(this._toastTimer);
        requestAnimationFrame(() => toast.classList.add('show'));
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
    }

    animateOnScroll() {
        const items = document.querySelectorAll('.bento-item');

        items.forEach((el, idx) => {
            el.style.animationDelay = `${Math.min(idx * 30, 600)}ms`;
        });
    }

    // =========================================================
    // Confirmación de reserva
    // =========================================================

    async confirmReservation() {
        if (this.cart.length === 0) return;

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 5);

        const expiryStr = expiryDate.toLocaleDateString('es-MX', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const totalArea = this.cart.reduce((s, i) => s + (i.area || 0), 0).toFixed(2);
        const totalCount = this.cart.length;

        const disclaimer = document.createElement('div');
        disclaimer.id = 'reservation-disclaimer';
        disclaimer.style.cssText = `
            position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;
            display:flex;align-items:center;justify-content:center;
            padding:20px;box-sizing:border-box;animation:fadeInOverlay 0.25s ease;
        `;

        disclaimer.innerHTML = `
            <style>
                @keyframes fadeInOverlay { from{opacity:0} to{opacity:1} }
                @keyframes slideUpModal { from{opacity:0;transform:translateY(30px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
                #disclaimer-box { animation:slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1) forwards; }
                #disclaimer-confirm:hover { background:#e8c468!important; box-shadow:0 8px 28px rgba(212,175,55,0.55); transform:translateY(-1px); }
                #disclaimer-cancel:hover { background:rgba(255,255,255,0.06)!important; border-color:#777!important; color:#fff!important; }
            </style>

            <div id="disclaimer-box" style="background:#0f0f0f;border:1px solid rgba(212,175,55,0.3);border-radius:18px;max-width:520px;width:100%;overflow:hidden;box-shadow:0 0 80px rgba(212,175,55,0.2),0 24px 64px rgba(0,0,0,0.7);">
                <div style="background:linear-gradient(135deg,#a8801e 0%,#d4af37 50%,#a8801e 100%);padding:24px 28px 20px;text-align:center;position:relative;">
                    <div style="font-size:2.6rem;line-height:1;margin-bottom:6px;">⏳</div>
                    <h2 style="margin:0;color:#0f0f0f;font-size:1.05rem;font-weight:900;letter-spacing:2px;text-transform:uppercase;">Confirma tu Reserva</h2>
                    <p style="margin:6px 0 0;color:rgba(0,0,0,0.65);font-size:0.78rem;font-weight:600;letter-spacing:0.5px;">Lee las condiciones antes de continuar</p>
                </div>

                <div style="padding:22px 28px 24px;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">
                        <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px;text-align:center;">
                            <div style="font-size:0.66rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Placas</div>
                            <div style="font-size:1.5rem;color:#fff;font-weight:800;line-height:1;">${totalCount}</div>
                        </div>

                        <div style="background:rgba(255,255,255,0.03);border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px;text-align:center;">
                            <div style="font-size:0.66rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Total m²</div>
                            <div style="font-size:1.5rem;color:#d4af37;font-weight:800;line-height:1;">${totalArea}</div>
                        </div>
                    </div>

                    <div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.25);border-left:4px solid #d4af37;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:14px;">
                        <p style="margin:0 0 8px;color:#fff;font-size:0.95rem;font-weight:700;line-height:1.5;">
                            Apartado por <span style="color:#d4af37;">5 días calendario</span>
                        </p>
                        <p style="margin:0;color:#b0b0b0;font-size:0.82rem;line-height:1.6;">
                            Vencimiento: <strong style="color:#e0e0e0;">${this.escapeHtml(expiryStr)}</strong>
                        </p>
                    </div>

                    <div style="display:flex;align-items:flex-start;gap:12px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.22);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
                        <i class="fa fa-exclamation-triangle" style="color:#ef4444;font-size:0.95rem;margin-top:2px;flex-shrink:0;"></i>
                        <p style="margin:0;color:#d8b0b0;font-size:0.8rem;line-height:1.6;">
                            Al vencer, las placas se <strong style="color:#fca5a5;">liberan automáticamente</strong> sin previo aviso.
                        </p>
                    </div>

                    <div style="display:flex;align-items:flex-start;gap:12px;background:rgba(255,255,255,0.02);border-radius:10px;padding:11px 14px;margin-bottom:20px;">
                        <i class="fa-brands fa-whatsapp" style="color:#25D366;font-size:1rem;margin-top:2px;flex-shrink:0;"></i>
                        <p style="margin:0;color:#888;font-size:0.78rem;line-height:1.6;">
                            Al confirmar, se abrirá WhatsApp con un mensaje listo para avisar a tu ejecutivo. Solo tendrás que presionar enviar.
                        </p>
                    </div>

                    <div style="display:flex;gap:10px;">
                        <button id="disclaimer-cancel" type="button" style="flex:1;padding:13px 10px;background:transparent;border:1px solid #3a3a3a;color:#999;border-radius:10px;cursor:pointer;font-size:0.88rem;font-weight:700;transition:all 0.2s;">
                            Cancelar
                        </button>

                        <button id="disclaimer-confirm" type="button" style="flex:2;padding:13px 10px;background:linear-gradient(135deg,#a8801e,#d4af37);border:none;color:#0f0f0f;border-radius:10px;cursor:pointer;font-size:0.92rem;font-weight:900;text-transform:uppercase;letter-spacing:1.2px;transition:all 0.25s;box-shadow:0 6px 18px rgba(212,175,55,0.3);">
                            <i class="fa fa-check me-2"></i> Sí, Apartar Ahora
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(disclaimer);
        document.body.style.overflow = 'hidden';

        const userConfirmed = await new Promise(resolve => {
            const cancelBtn = document.getElementById('disclaimer-cancel');
            const confirmBtn = document.getElementById('disclaimer-confirm');

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => resolve(false));
            }

            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => resolve(true));
            }

            disclaimer.addEventListener('click', (e) => {
                if (e.target === disclaimer) {
                    resolve(false);
                }
            });
        });

        if (document.body.contains(disclaimer)) {
            document.body.removeChild(disclaimer);
        }

        document.body.style.overflow = '';

        if (!userConfirmed) return;

        const btn = document.getElementById('btn-confirm');
        const originalHTML = btn ? btn.innerHTML : '';

        if (btn) {
            btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Procesando...';
            btn.disabled = true;
        }

        try {
            if (!this.config.token) {
                throw new Error('Token no encontrado.');
            }

            const response = await fetch('/gallery/confirm_reservation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: {
                        token: this.config.token,
                        items: this.cart
                    },
                    id: Math.floor(Math.random() * 1000)
                })
            });

            const result = await response.json();

            if (result.result && result.result.success) {
                const whatsappUrl = result.result.whatsapp_url || '';
                const salespersonName = result.result.salesperson_name || '';

                this.showSuccessModal(
                    result.result.order_name,
                    whatsappUrl,
                    salespersonName
                );

                this.cart = [];
                this.saveCart();
                this.updateCartUI();
                this.updateButtonsState();
                this.updateSelectionStates();

                if (whatsappUrl) {
                    setTimeout(() => {
                        this.openWhatsApp(whatsappUrl);
                    }, 900);

                    setTimeout(() => window.location.reload(), 9000);
                } else {
                    this.showToast(
                        'Reserva creada. El vendedor no tiene celular configurado para WhatsApp.',
                        'warning'
                    );

                    setTimeout(() => window.location.reload(), 5500);
                }
            } else {
                const msg = result.error
                    ? result.error.data.message
                    : (result.result ? result.result.message : 'Error desconocido');

                this.showToast('No se pudo reservar: ' + msg, 'error');

                if (btn) {
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                }
            }
        } catch (error) {
            console.error(error);
            this.showToast('Error de conexión', 'error');

            if (btn) {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        }
    }

    showSuccessModal(orderName, whatsappUrl = '', salespersonName = '') {
        const safeOrderName = this.escapeHtml(orderName);
        const safeWhatsappUrl = this.escapeHtml(whatsappUrl);
        const safeSalespersonName = this.escapeHtml(salespersonName || 'tu ejecutivo');

        const whatsappBlock = whatsappUrl ? `
            <div style="background:rgba(37,211,102,0.08);border:1px solid rgba(37,211,102,0.28);border-radius:12px;padding:14px;margin-bottom:18px;text-align:left;">
                <div style="display:flex;align-items:flex-start;gap:12px;">
                    <div style="width:36px;height:36px;border-radius:50%;background:#25D366;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.1rem;">
                        <i class="fa-brands fa-whatsapp"></i>
                    </div>
                    <div style="min-width:0;">
                        <div style="color:#fff;font-weight:800;font-size:0.88rem;margin-bottom:4px;">
                            WhatsApp listo para ${safeSalespersonName}
                        </div>
                        <div style="color:#9fd8b4;font-size:0.76rem;line-height:1.5;">
                            Se abrirá una conversación con el mensaje precargado para avisar que ya realizaste el apartado.
                        </div>
                    </div>
                </div>
            </div>

            <a href="${safeWhatsappUrl}"
               target="_blank"
               rel="noopener noreferrer"
               style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:linear-gradient(135deg,#25D366,#1da851);color:#fff;border:none;border-radius:10px;padding:13px 14px;text-decoration:none;font-size:0.88rem;font-weight:900;text-transform:uppercase;letter-spacing:0.8px;box-shadow:0 6px 20px rgba(37,211,102,0.28);margin-bottom:14px;">
                <i class="fa-brands fa-whatsapp"></i>
                Abrir WhatsApp
            </a>
        ` : `
            <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:12px;padding:13px 14px;margin-bottom:18px;text-align:left;">
                <div style="display:flex;gap:10px;align-items:flex-start;">
                    <i class="fa fa-triangle-exclamation" style="color:#fbbf24;margin-top:2px;"></i>
                    <p style="margin:0;color:#f6d58a;font-size:0.78rem;line-height:1.5;">
                        La reserva fue creada, pero el vendedor no tiene celular configurado para generar el WhatsApp automático.
                    </p>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;
            display:flex;align-items:center;justify-content:center;padding:20px;
            animation:fadeInOverlay 0.3s ease;
        `;

        modal.innerHTML = `
            <style>
                @keyframes successPop { 0%{transform:scale(0.5);opacity:0} 60%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1} }
                @keyframes checkDraw { from{stroke-dashoffset:60} to{stroke-dashoffset:0} }
            </style>

            <div style="background:#0f0f0f;border:1px solid rgba(212,175,55,0.3);border-radius:20px;max-width:480px;width:100%;padding:42px 32px 36px;text-align:center;box-shadow:0 0 100px rgba(212,175,55,0.25);animation:successPop 0.55s cubic-bezier(0.16,1,0.3,1);">
                <div style="width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#22c55e,#16a34a);margin:0 auto 22px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 40px rgba(34,197,94,0.4);">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" style="stroke-dasharray:60;animation:checkDraw 0.6s 0.2s ease forwards;stroke-dashoffset:60;"/>
                    </svg>
                </div>

                <h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:2rem;color:#fff;margin:0 0 8px;font-weight:500;">
                    ¡Reserva Confirmada!
                </h2>

                <p style="color:#b0b0b0;margin:0 0 22px;font-size:0.9rem;line-height:1.55;">
                    Tus placas quedaron apartadas exclusivamente para ti.
                </p>

                <div style="background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:14px;margin-bottom:18px;">
                    <div style="font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px;">
                        Tu referencia
                    </div>
                    <div style="font-size:1.3rem;color:#d4af37;font-weight:800;letter-spacing:1px;">
                        ${safeOrderName}
                    </div>
                </div>

                ${whatsappBlock}

                <p style="color:#777;font-size:0.78rem;margin:0;line-height:1.55;">
                    Conserva esta referencia para formalizar tu compra con tu ejecutivo.
                </p>
            </div>
        `;

        document.body.appendChild(modal);
    }
}

window.gallery = new GalleryApp();