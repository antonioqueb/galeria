// static/src/js/gallery_public.js

class GalleryApp {
    constructor() {
        this.cart = [];
        // Clave única por token para no mezclar carritos de diferentes clientes/links
        this.cartKey = 'stone_gallery_cart_' + (window.galleryConfig ? window.galleryConfig.token : 'default');
        
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
                console.error("Error parsing cart", e);
                this.cart = [];
            }
        }

        this.updateCartUI();
        this.updateButtonsState();

        // Event listener para el botón del header
        const cartToggleBtn = document.getElementById('cart-toggle');
        if (cartToggleBtn) {
            cartToggleBtn.addEventListener('click', () => this.toggleCart());
        }
    }

    addToCart(btn) {
        const itemEl = btn.closest('.bento-item');
        if (!itemEl) return;

        const id = itemEl.dataset.id;
        
        // Verificar si ya existe para hacer toggle (quitar si ya está)
        const existingIndex = this.cart.findIndex(i => String(i.id) === String(id));

        if (existingIndex > -1) {
            this.removeFromCart(id);
            return;
        }

        // Crear objeto producto
        const product = {
            id: id,
            quant_id: itemEl.dataset.quantId,
            name: itemEl.dataset.name,
            lot_name: itemEl.dataset.lot,
            dims: itemEl.dataset.dims,
            area: parseFloat(itemEl.dataset.area || 0),
            url: itemEl.dataset.url
        };

        this.cart.push(product);
        this.saveCart();
        this.updateCartUI();
        this.updateButtonsState();
        
        btn.classList.add('in-cart');
    }

    removeFromCart(id) {
        const strId = String(id);
        this.cart = this.cart.filter(item => String(item.id) !== strId);
        this.saveCart();
        this.updateCartUI();
        this.updateButtonsState();
    }

    saveCart() {
        localStorage.setItem(this.cartKey, JSON.stringify(this.cart));
    }

    updateButtonsState() {
        // Contador del header
        const counter = document.getElementById('cart-count');
        if (counter) {
            counter.innerText = this.cart.length;
            counter.style.display = this.cart.length > 0 ? 'inline-block' : 'none';
        }

        // Botones de las tarjetas
        document.querySelectorAll('.bento-item').forEach(el => {
            const btn = el.querySelector('.btn-add-cart');
            const id = el.dataset.id;
            const icon = btn.querySelector('i');

            if (this.cart.find(i => String(i.id) === String(id))) {
                btn.classList.add('in-cart');
                if (icon) {
                    icon.classList.remove('fa-plus');
                    icon.classList.add('fa-check');
                }
            } else {
                btn.classList.remove('in-cart');
                if (icon) {
                    icon.classList.remove('fa-check');
                    icon.classList.add('fa-plus');
                }
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
                    <button class="btn-remove" onclick="gallery.removeFromCart('${item.id}')" title="Eliminar">
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

    // --- Lightbox Zoom ---
    openLightbox(btn) {
        const itemEl = btn.closest('.bento-item');
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

    // --- Server API ---
    async confirmReservation() {
        if (this.cart.length === 0) return;

        const btn = document.getElementById('btn-confirm');
        const originalText = btn.innerText;
        btn.innerText = "Procesando...";
        btn.disabled = true;

        try {
            if (!window.galleryConfig || !window.galleryConfig.token) {
                throw new Error("Token no encontrado.");
            }

            const response = await fetch('/gallery/confirm_reservation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: {
                        token: window.galleryConfig.token,
                        items: this.cart
                    },
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
            if (btn) {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

window.gallery = new GalleryApp();