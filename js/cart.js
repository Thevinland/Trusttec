/**
 * @fileoverview Shopping Cart – Trusttec
 * v3.0.0 – Couleur stockée et affichée séparément ; écoute du CustomEvent
 * depuis la Vue Rapide ; clé composite id+couleur pour variants distincts.
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    const config = {
        localStorageKey: 'trusttecCart_v3',
        whatsappNumber:  '242056323722',
        currency:        'XAF',
        locale:          'fr-FR',
        toastDisplayTime: 3000,
        maxQuantityPerItem: 100,
        selectors: {
            cartCountBadge:          '.cart-count-badge',
            cartModal:               '#cartModal',
            cartItemsContainer:      '#cart-items-container',
            cartEmptyMsg:            '#cart-empty-msg',
            cartTotalPrice:          '#cart-total-price',
            clearCartBtn:            '#clear-cart-btn',
            whatsappOrderBtn:        '#whatsapp-order-btn',
            addToCartBtnClass:       '.add-to-cart-btn',
            quantityDecreaseBtnClass:'.quantity-decrease',
            quantityIncreaseBtnClass:'.quantity-increase',
            quantityInputClass:      '.quantity-input',
            removeFromCartBtnClass:  '.remove-from-cart-btn',
            toastContainerId:        'toast-container',
        },
        htmlClasses: {
            cartItem:                   'cart-item',
            disabled:                   'disabled',
            modalShow:                  'show',
            toastContainerPosition:     'position-fixed bottom-0 end-0 p-3',
            toastBase:                  'toast',
            toastAlignItems:            'align-items-center',
            toastBorder:                'border-0',
            toastBody:                  'toast-body',
            toastDismissButton:         'btn-close',
            toastDismissButtonWhite:    'btn-close-white',
            bgSuccess: 'text-bg-success',
            bgError:   'text-bg-danger',
            bgWarning: 'text-bg-warning',
            bgInfo:    'text-bg-info',
        },
        icons: {
            success: 'bi-check-circle-fill',
            error:   'bi-exclamation-triangle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info:    'bi-info-circle-fill',
            remove:  'bi-trash',
        },
    };

    // --- DOM ---
    const dom = {
        cartModalElement:    document.getElementById(config.selectors.cartModal.substring(1)),
        cartItemsContainer:  document.getElementById(config.selectors.cartItemsContainer.substring(1)),
        cartEmptyMsg:        document.getElementById(config.selectors.cartEmptyMsg.substring(1)),
        cartTotalPriceEl:    document.getElementById(config.selectors.cartTotalPrice.substring(1)),
        clearCartBtn:        document.getElementById(config.selectors.clearCartBtn.substring(1)),
        whatsappOrderBtn:    document.getElementById(config.selectors.whatsappOrderBtn.substring(1)),
        body:                document.body,
    };

    if (!dom.cartItemsContainer || !dom.cartTotalPriceEl || !dom.cartEmptyMsg ||
        !dom.clearCartBtn || !dom.whatsappOrderBtn || !dom.cartModalElement) {
        console.error('FATAL: Éléments du panier introuvables. Fonctionnalité désactivée.');
        return;
    }

    // --- État ---
    let cart = [];

    // ─── Helpers ────────────────────────────────────────────────────────────

    const formatCurrency = (value) => {
        if (typeof value !== 'number' || isNaN(value)) return 'N/A';
        return value.toLocaleString(config.locale, { style: 'currency', currency: config.currency });
    };

    /**
     * Clé unique par variante : "PROD001__Noir" ou "PROD001" si pas de couleur.
     */
    const makeCartKey = (id, colorName) => colorName ? `${id}__${colorName}` : id;

    const isValidItem = (item) =>
        item &&
        typeof item.id       === 'string' && item.id.trim() !== '' &&
        typeof item.name     === 'string' && item.name.trim() !== '' &&
        typeof item.price    === 'number' && !isNaN(item.price) && item.price >= 0 &&
        typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0 &&
        typeof item.img      === 'string';

    const loadCartFromStorage = () => {
        try {
            const raw = localStorage.getItem(config.localStorageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(isValidItem);
        } catch { localStorage.removeItem(config.localStorageKey); return []; }
    };

    const saveCartToStorage = () => {
        try {
            const valid = cart.filter(isValidItem);
            localStorage.setItem(config.localStorageKey, JSON.stringify(valid));
        } catch (e) {
            console.error('Erreur sauvegarde panier :', e);
            showToast('Erreur lors de la sauvegarde du panier.', 'error');
        }
    };

    const findItemIndex = (cartKey) => cart.findIndex(i => i && i.id === cartKey);

    const calculateTotals = () => cart.reduce((acc, item) => {
        if (item && typeof item.price === 'number' && typeof item.quantity === 'number') {
            acc.totalPrice += item.price * item.quantity;
            acc.totalItems += item.quantity;
        }
        return acc;
    }, { totalPrice: 0, totalItems: 0 });

    // ─── Logique panier ──────────────────────────────────────────────────────

    const updateCartStateAndUI = () => { saveCartToStorage(); updateCartUI(); };

    /**
     * Ajoute ou incrémente un article dans le panier.
     * @param {string}  id         - ID produit (ex: "DD003")
     * @param {string}  name       - Nom du produit
     * @param {number}  price      - Prix unitaire
     * @param {string}  img        - URL image
     * @param {string}  colorName  - Nom de la couleur (peut être vide)
     * @param {string}  colorHex   - Code hex de la couleur (peut être vide)
     * @param {number}  [qty=1]    - Quantité à ajouter
     */
    const addToCart = ({ id, name, price, img, colorName = '', colorHex = '', qty = 1 }) => {
        if (!id || !name || typeof price !== 'number' || isNaN(price) || price < 0 || typeof img !== 'string') {
            console.error('addToCart: données invalides', { id, name, price, img });
            showToast(`Données invalides pour « ${name || 'cet article'} ».`, 'error');
            return;
        }

        const cartKey   = makeCartKey(id, colorName);
        const existing  = findItemIndex(cartKey);
        const addedQty  = Math.max(1, Math.floor(qty));
        const label     = colorName ? `${name} <span style="opacity:.7;font-weight:400">(${colorName})</span>` : name;

        if (existing > -1) {
            const newQty = cart[existing].quantity + addedQty;
            if (newQty <= config.maxQuantityPerItem) {
                cart[existing].quantity = newQty;
                showToast(`${name}${colorName ? ` (${colorName})` : ''} — quantité : ${newQty}`, 'success');
            } else {
                showToast(`Quantité max (${config.maxQuantityPerItem}) atteinte.`, 'warning');
                return;
            }
        } else {
            cart.push({ id: cartKey, name, price, quantity: addedQty, img, colorName, colorHex });
            showToast(`${name}${colorName ? ` (${colorName})` : ''} ajouté au panier !`, 'success');
        }
        updateCartStateAndUI();
    };

    const updateQuantity = (cartKey, newQuantityInput) => {
        const idx = findItemIndex(cartKey);
        if (idx === -1) { showToast('Article introuvable.', 'error'); return; }
        const qty = Math.floor(Number(newQuantityInput));
        if (isNaN(qty)) { showToast('Quantité invalide.', 'warning'); updateCartUI(); return; }
        const validated = Math.max(0, Math.min(qty, config.maxQuantityPerItem));
        const itemName  = cart[idx].name;
        if (validated === 0) {
            cart.splice(idx, 1);
            showToast(`${itemName} supprimé du panier.`, 'info');
        } else {
            cart[idx].quantity = validated;
            if (qty > config.maxQuantityPerItem) showToast(`Quantité limitée à ${config.maxQuantityPerItem}.`, 'warning');
        }
        updateCartStateAndUI();
    };

    const removeFromCart = (cartKey) => {
        const idx = findItemIndex(cartKey);
        if (idx > -1) {
            const name = cart[idx].name;
            cart.splice(idx, 1);
            updateCartStateAndUI();
            showToast(`${name} supprimé du panier.`, 'info');
        } else {
            showToast('Erreur : article introuvable.', 'error');
        }
    };

    const clearCart = () => {
        if (cart.length > 0) { cart = []; updateCartStateAndUI(); showToast('Panier vidé.', 'info'); }
        else showToast('Le panier est déjà vide.', 'info');
    };

    // ─── Mise à jour UI ──────────────────────────────────────────────────────

    const updateCartBadge = (totalItems) => {
        document.querySelectorAll(config.selectors.cartCountBadge).forEach(el => {
            const n = Math.max(0, Math.floor(totalItems));
            el.textContent   = n;
            el.style.display = n > 0 ? 'flex' : 'none';
        });
    };

    /** Génère le HTML d'un article dans le panier. */
    const createCartItemHTML = (item) => {
        if (!isValidItem(item)) { console.error('Article invalide :', item); return ''; }

        const total    = item.price * item.quantity;
        const safeName = item.name.replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const safeImg  = item.img;

        // Pastille couleur
        const colorChip = item.colorName
            ? `<div style="display:inline-flex;align-items:center;gap:5px;font-size:.75rem;color:#555;margin-top:3px;">
                   <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${item.colorHex || '#ccc'};border:1px solid rgba(0,0,0,.2);flex-shrink:0;"></span>
                   ${item.colorName.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
               </div>`
            : '';

        const dec = config.selectors.quantityDecreaseBtnClass.substring(1);
        const inp = config.selectors.quantityInputClass.substring(1);
        const inc = config.selectors.quantityIncreaseBtnClass.substring(1);
        const rem = config.selectors.removeFromCartBtnClass.substring(1);

        return `
        <div class="${config.htmlClasses.cartItem} d-flex flex-column flex-md-row align-items-md-center mb-3 border-bottom pb-3" data-item-id="${item.id}">
            <img src="${safeImg}" alt="${safeName}" class="img-fluid rounded me-md-3 mb-2 mb-md-0"
                 style="width:80px;height:80px;object-fit:contain;" loading="lazy">

            <div class="flex-grow-1 mb-2 mb-md-0 text-center text-md-start">
                <h6 class="mb-0 cart-item-name">${safeName}</h6>
                ${colorChip}
                <small class="text-muted cart-item-price d-block mt-1">${formatCurrency(item.price)} / unité</small>
            </div>

            <div class="d-flex align-items-center justify-content-center mx-md-3 mb-2 mb-md-0" style="flex-shrink:0;">
                <button class="btn btn-sm btn-outline-secondary ${dec}" data-id="${item.id}" aria-label="Diminuer">−</button>
                <input type="number" class="form-control form-control-sm ${inp} mx-1 text-center"
                       value="${item.quantity}" min="1" max="${config.maxQuantityPerItem}"
                       data-id="${item.id}" aria-label="Quantité" style="width:60px;">
                <button class="btn btn-sm btn-outline-secondary ${inc}" data-id="${item.id}" aria-label="Augmenter">+</button>
            </div>

            <div class="text-center text-md-end me-md-3 mb-2 mb-md-0 fw-bold" style="min-width:110px;flex-shrink:0;">
                ${formatCurrency(total)}
            </div>

            <button class="btn btn-sm btn-outline-danger ${rem} align-self-center" data-id="${item.id}" title="Supprimer">
                <i class="bi ${config.icons.remove} d-none d-md-inline"></i>
                <span class="d-inline d-md-none">Supprimer</span>
            </button>
        </div>`;
    };

    const updateWhatsAppLink = (totalPrice) => {
        if (!dom.whatsappOrderBtn) return;
        if (cart.length === 0) {
            dom.whatsappOrderBtn.classList.add(config.htmlClasses.disabled);
            dom.whatsappOrderBtn.removeAttribute('href');
            dom.whatsappOrderBtn.setAttribute('aria-disabled', 'true');
            dom.whatsappOrderBtn.removeAttribute('target');
            return;
        }
        let msg = 'Bonjour Trusttec,\n\nJe souhaite commander :\n';
        cart.forEach(item => {
            if (!item || typeof item.price !== 'number' || typeof item.quantity !== 'number') return;
            msg += `\n📦 ${item.name}`;
            if (item.colorName) msg += `\n   🎨 Couleur : ${item.colorName}`;
            msg += `\n   📊 Quantité : ${item.quantity} × ${formatCurrency(item.price)} = ${formatCurrency(item.price * item.quantity)}`;
        });
        msg += `\n\n${'─'.repeat(20)}\n💰 Total : ${formatCurrency(totalPrice)}\n${'─'.repeat(20)}`;
        msg += '\n\nMerci de confirmer disponibilité, paiement et livraison.';

        dom.whatsappOrderBtn.classList.remove(config.htmlClasses.disabled);
        dom.whatsappOrderBtn.href = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(msg)}`;
        dom.whatsappOrderBtn.setAttribute('aria-disabled', 'false');
        dom.whatsappOrderBtn.setAttribute('target', '_blank');
        dom.whatsappOrderBtn.setAttribute('rel', 'noopener noreferrer');
    };

    const displayCart = () => {
        dom.cartItemsContainer.innerHTML = '';
        if (cart.length === 0) {
            dom.cartEmptyMsg.style.display       = 'block';
            dom.cartItemsContainer.style.display = 'none';
            dom.cartTotalPriceEl.textContent     = formatCurrency(0);
            updateWhatsAppLink(0);
            dom.clearCartBtn?.classList.add(config.htmlClasses.disabled);
            return;
        }
        dom.cartEmptyMsg.style.display       = 'none';
        dom.cartItemsContainer.style.display = 'block';

        const frag   = document.createDocumentFragment();
        let   total  = 0;
        cart.forEach(item => {
            if (!isValidItem(item)) return;
            const html = createCartItemHTML(item);
            if (!html) return;
            const wrap = document.createElement('div');
            wrap.innerHTML = html.trim();
            if (wrap.firstChild) { frag.appendChild(wrap.firstChild); total += item.price * item.quantity; }
        });
        dom.cartItemsContainer.appendChild(frag);
        dom.cartTotalPriceEl.textContent = formatCurrency(total);
        updateWhatsAppLink(total);
        dom.clearCartBtn?.classList.remove(config.htmlClasses.disabled);
    };

    const updateCartUI = () => {
        const { totalItems, totalPrice } = calculateTotals();
        updateCartBadge(totalItems);
        updateWhatsAppLink(totalPrice);
        if (dom.clearCartBtn) {
            dom.clearCartBtn.classList.toggle(config.htmlClasses.disabled, cart.length === 0);
            dom.clearCartBtn.setAttribute('aria-disabled', cart.length === 0 ? 'true' : 'false');
        }
        if (dom.cartModalElement?.classList.contains(config.htmlClasses.modalShow)) displayCart();
    };

    // ─── Toast ───────────────────────────────────────────────────────────────

    const getOrCreateToastContainer = () => {
        if (!dom.body) return null;
        let c = document.getElementById(config.selectors.toastContainerId);
        if (!c) {
            c = document.createElement('div');
            c.id        = config.selectors.toastContainerId;
            c.className = `toast-container ${config.htmlClasses.toastContainerPosition}`;
            c.style.zIndex = '1100';
            dom.body.appendChild(c);
        }
        return c;
    };

    const showToast = (message, type = 'info') => {
        const container = getOrCreateToastContainer();
        if (!container) return;
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        const bgMap = { success: config.htmlClasses.bgSuccess, error: config.htmlClasses.bgError, warning: config.htmlClasses.bgWarning, info: config.htmlClasses.bgInfo };
        const icMap = { success: config.icons.success, error: config.icons.error, warning: config.icons.warning, info: config.icons.info };
        const bg    = bgMap[type] || config.htmlClasses.bgInfo;
        const icon  = icMap[type] || config.icons.info;
        const role  = (type === 'error' || type === 'warning') ? 'alert' : 'status';

        container.insertAdjacentHTML('beforeend', `
            <div id="${id}" class="${config.htmlClasses.toastBase} ${config.htmlClasses.toastAlignItems} ${bg} ${config.htmlClasses.toastBorder}"
                 role="${role}" aria-live="${role === 'alert' ? 'assertive' : 'polite'}" aria-atomic="true"
                 data-bs-delay="${config.toastDisplayTime}">
                <div class="d-flex">
                    <div class="${config.htmlClasses.toastBody}">
                        <i class="bi ${icon} me-2" aria-hidden="true"></i>${message}
                    </div>
                    <button type="button" class="${config.htmlClasses.toastDismissButton} ${config.htmlClasses.toastDismissButtonWhite} me-2 m-auto"
                            data-bs-dismiss="toast" aria-label="Fermer"></button>
                </div>
            </div>`);

        const el = document.getElementById(id);
        if (!el) return;
        try {
            const t = new bootstrap.Toast(el, { delay: config.toastDisplayTime });
            el.addEventListener('hidden.bs.toast', () => el.remove(), { once: true });
            t.show();
        } catch (e) { console.error('Erreur toast Bootstrap :', e); el.remove(); }
    };

    // ─── Gestionnaires d'événements ──────────────────────────────────────────

    /**
     * Clics sur .add-to-cart-btn (boutons des cartes produit).
     * Les attributs data-color-name et data-color-hex sont mis à jour par produits.html
     * lors du choix d'un swatch.
     */
    const handleAddToCartClick = (event) => {
        const btn = event.target.closest(config.selectors.addToCartBtnClass);
        if (!btn) return;
        event.preventDefault();

        const { id, name, price, img } = btn.dataset;
        const colorName = btn.dataset.colorName || '';
        const colorHex  = btn.dataset.colorHex  || '';

        if (!id || !name || price === undefined || !img) {
            showToast("Données produit manquantes.", 'error'); return;
        }
        const numericPrice = parseFloat(price);
        if (isNaN(numericPrice) || numericPrice < 0) {
            showToast("Prix invalide.", 'error'); return;
        }
        addToCart({ id: String(id), name: String(name), price: numericPrice, img: String(img), colorName, colorHex });
    };

    /**
     * Interactions dans le modal panier (quantité, suppression).
     * Utilise data-id qui contient la cartKey (id__couleur ou id).
     */
    const handleCartInteraction = (event) => {
        const t   = event.target;
        const dec = t.closest(config.selectors.quantityDecreaseBtnClass);
        const inc = t.closest(config.selectors.quantityIncreaseBtnClass);
        const rem = t.closest(config.selectors.removeFromCartBtnClass);
        const inp = t.matches(config.selectors.quantityInputClass) ? t : null;
        const cartKey = dec?.dataset.id || inc?.dataset.id || rem?.dataset.id || inp?.dataset.id;
        if (!cartKey) return;

        const current = cart.find(i => i.id === cartKey);
        if (!current && (dec || inc || rem || inp)) {
            showToast("Article introuvable dans le panier.", 'error');
            updateCartUI(); return;
        }
        if      (dec && event.type === 'click')  updateQuantity(cartKey, current.quantity - 1);
        else if (inc && event.type === 'click')  updateQuantity(cartKey, current.quantity + 1);
        else if (rem && event.type === 'click')  removeFromCart(cartKey);
        else if (inp && event.type === 'change') {
            const q = parseInt(inp.value, 10);
            if (!isNaN(q)) updateQuantity(cartKey, q);
            else { inp.value = current?.quantity ?? 1; showToast('Quantité invalide.', 'warning'); }
        }
    };

    const handleNumberInputWheel = (event) => {
        const inp = event.target.closest(`${config.selectors.cartItemsContainer} input[type="number"]`);
        if (inp && document.activeElement === inp) { event.preventDefault(); inp.blur(); }
    };

    // ─── Initialisation ──────────────────────────────────────────────────────

    const initEventListeners = () => {
        // Cartes produit
        dom.body.addEventListener('click', handleAddToCartClick);

        // Événement personnalisé émis par la Vue Rapide (produits.html)
        document.addEventListener('addToCartCustom', (e) => {
            const { id, name, price, img, colorName = '', colorHex = '', qty = 1 } = e.detail || {};
            if (!id || !name) return;
            const p = parseFloat(price);
            if (isNaN(p)) return;
            addToCart({ id: String(id), name: String(name), price: p, img: String(img), colorName, colorHex, qty });
        });

        // Modal panier
        if (dom.cartItemsContainer) {
            dom.cartItemsContainer.addEventListener('click',  handleCartInteraction);
            dom.cartItemsContainer.addEventListener('change', handleCartInteraction);
            dom.cartItemsContainer.addEventListener('wheel',  handleNumberInputWheel, { passive: false });
        }
        dom.clearCartBtn?.addEventListener('click', clearCart);
        dom.cartModalElement?.addEventListener('show.bs.modal', displayCart);

        // Sync multi-onglets
        window.addEventListener('storage', (e) => {
            if (e.key === config.localStorageKey && e.oldValue !== e.newValue) {
                cart = loadCartFromStorage();
                updateCartUI();
                showToast('Panier mis à jour depuis un autre onglet.', 'info');
            }
        });
    };

    const initializeCart = () => {
        cart = loadCartFromStorage();
        initEventListeners();
        updateCartUI();
        console.log(`Trusttec Cart v3.0.0 — ${cart.length} article(s) chargé(s).`);
    };

    if (typeof bootstrap !== 'undefined' && bootstrap.Modal && bootstrap.Toast) {
        initializeCart();
    } else {
        console.error('FATAL: Bootstrap 5 JS introuvable. Panier désactivé.');
    }

}); // DOMContentLoaded
