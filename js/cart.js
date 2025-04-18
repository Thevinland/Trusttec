/**
 * @fileoverview Shopping Cart functionality for Trusttec website.
 * Handles adding items, updating quantities, removing items, displaying the cart,
 * saving to localStorage, generating a WhatsApp order, and showing notifications.
 * Relies on Bootstrap 5 for modal and toast components.
 *
 * @version 2.1.1 - Corrected badge update using class selector.
 * @author Your Name/Trusttec Dev Team
 * @description Version 2.1.1 fixes badge update issue by using class selectors instead of IDs.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const config = {
        localStorageKey: 'trusttecCart_v2', // Use a versioned key if structure changes
        whatsappNumber: '242056323722', // WhatsApp number without '+' or spaces
        currency: 'XAF',
        locale: 'fr-FR', // For number and currency formatting
        toastDisplayTime: 3000, // milliseconds
        selectors: {
            // Cibler via l'attribut est plus robuste si plusieurs boutons ouvrent le modal
            cartIcon: '[data-bs-target="#cartModal"]',
            cartCountBadge: '.cart-count-badge', // MODIFIÉ ICI: Utilise la classe
            cartModal: '#cartModal',
            cartItemsContainer: '#cart-items-container',
            cartEmptyMsg: '#cart-empty-msg',
            cartTotalPrice: '#cart-total-price',
            clearCartBtn: '#clear-cart-btn',
            whatsappOrderBtn: '#whatsapp-order-btn',
            addToCartBtnClass: '.add-to-cart-btn',
            quantityDecreaseBtnClass: '.quantity-decrease',
            quantityIncreaseBtnClass: '.quantity-increase',
            quantityInputClass: '.quantity-input',
            removeFromCartBtnClass: '.remove-from-cart-btn',
            toastContainerId: 'toast-container',
        },
        htmlClasses: {
            cartItem: 'cart-item',
            disabled: 'disabled', // Bootstrap disabled class
            modalShow: 'show', // Bootstrap class when modal is visible
            // Toast classes
            toastContainerPosition: 'position-fixed bottom-0 end-0 p-3',
            toastBase: 'toast',
            toastAlignItems: 'align-items-center',
            toastBorder: 'border-0',
            toastHeader: 'toast-header', // Optional: if you want headers
            toastBody: 'toast-body',
            toastDismissButton: 'btn-close',
            toastDismissButtonWhite: 'btn-close-white',
            // Backgrounds for toasts
            bgSuccess: 'text-bg-success',
            bgError: 'text-bg-danger',
            bgWarning: 'text-bg-warning',
            bgInfo: 'text-bg-info',
        },
        icons: {
            success: 'bi-check-circle-fill',
            error: 'bi-exclamation-triangle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info: 'bi-info-circle-fill',
            remove: 'bi-trash',
        },
        // Thresholds or limits (optional)
        maxQuantityPerItem: 100, // Example limit
    };

    // --- DOM Element Selection ---
    // Encapsulate selections for clarity and potential error handling
    const dom = {
        // Note: cartIcon now selects based on attribute, potentially multiple elements.
        cartIcon: document.querySelector(config.selectors.cartIcon), // Selects the first match
        // cartCountBadge: Now selected inside updateCartBadge using querySelectorAll
        cartModalElement: document.getElementById(config.selectors.cartModal.substring(1)),
        cartItemsContainer: document.getElementById(config.selectors.cartItemsContainer.substring(1)),
        cartEmptyMsg: document.getElementById(config.selectors.cartEmptyMsg.substring(1)),
        cartTotalPriceEl: document.getElementById(config.selectors.cartTotalPrice.substring(1)),
        clearCartBtn: document.getElementById(config.selectors.clearCartBtn.substring(1)),
        whatsappOrderBtn: document.getElementById(config.selectors.whatsappOrderBtn.substring(1)),
        body: document.body,
    };

    // Basic check if essential elements exist
    if (!dom.cartItemsContainer || !dom.cartTotalPriceEl || !dom.cartEmptyMsg || !dom.clearCartBtn || !dom.whatsappOrderBtn || !dom.cartModalElement) {
        console.error("FATAL: Essential cart DOM elements are missing. Cart functionality will be disabled.");
        if (dom.cartIcon) {
            document.querySelectorAll(config.selectors.cartIcon).forEach(icon => icon.style.display = 'none');
        }
        return; // Stop script execution if core elements are missing
    }
    // We don't check for the badge here anymore, as it's handled dynamically inside its update function.

    // --- State ---
    let cart = []; // Initialize cart state

    // --- Helper Functions ---

    /**
     * Formats a number as currency according to configuration.
     * @param {number} value - The number to format.
     * @returns {string} Formatted currency string.
     */
    const formatCurrency = (value) => {
        if (typeof value !== 'number' || isNaN(value)) {
            console.warn(`formatCurrency received non-numeric value: ${value}. Returning 'N/A'.`);
            return 'N/A';
        }
        return value.toLocaleString(config.locale, {
            style: 'currency',
            currency: config.currency,
        });
    };

    /**
     * Safely loads the cart from localStorage.
     * @returns {Array} The loaded cart array or an empty array if loading fails or data is invalid.
     */
    const loadCartFromStorage = () => {
        try {
            const storedCart = localStorage.getItem(config.localStorageKey);
            if (!storedCart) return [];

            const parsedCart = JSON.parse(storedCart);
            if (!Array.isArray(parsedCart)) {
                console.warn('Invalid cart data found in localStorage. Resetting cart.');
                return [];
            }
            return parsedCart.filter(item =>
                item && typeof item.id === 'string' && item.id.trim() !== '' &&
                typeof item.name === 'string' && item.name.trim() !== '' &&
                typeof item.price === 'number' && !isNaN(item.price) && item.price >= 0 &&
                typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0 &&
                typeof item.img === 'string'
            );
        } catch (error) {
            console.error("Error loading cart from localStorage:", error);
            localStorage.removeItem(config.localStorageKey);
            return [];
        }
    };

    /**
     * Safely saves the cart to localStorage.
     */
    const saveCartToStorage = () => {
        try {
            const validCart = cart.filter(item =>
                item && typeof item.id === 'string' && item.id.trim() !== '' &&
                typeof item.name === 'string' && item.name.trim() !== '' &&
                typeof item.price === 'number' && !isNaN(item.price) && item.price >= 0 &&
                typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0 &&
                typeof item.img === 'string'
            );
            if (validCart.length !== cart.length) {
                console.warn("Attempted to save invalid items to cart. Only valid items were saved.");
                cart = validCart;
            }
            localStorage.setItem(config.localStorageKey, JSON.stringify(validCart));
        } catch (error) {
            console.error("Error saving cart to localStorage:", error);
            showToast("Erreur lors de la sauvegarde du panier.", 'error');
        }
    };

    /**
     * Finds an item's index in the cart by its ID.
     * @param {string} id - The ID of the item to find.
     * @returns {number} The index of the item, or -1 if not found.
     */
    const findCartItemIndex = (id) => cart.findIndex(item => item && item.id === id);

    /**
     * Calculates the total price and total number of items in the cart.
     * @returns {{totalPrice: number, totalItems: number}} An object containing totals.
     */
    const calculateCartTotals = () => {
        return cart.reduce((totals, item) => {
            if (item && typeof item.price === 'number' && typeof item.quantity === 'number') {
                totals.totalPrice += item.price * item.quantity;
                totals.totalItems += item.quantity;
            } else {
                console.warn(`Invalid item found during total calculation: ${JSON.stringify(item)}`);
            }
            return totals;
        }, { totalPrice: 0, totalItems: 0 });
    };


    // --- Core Cart Logic ---

    /**
     * Updates the cart state and persists it, then updates the UI.
     */
    const updateCartStateAndUI = () => {
        saveCartToStorage();
        updateCartUI();
    };

    /**
     * Adds a product to the cart or increments its quantity.
     * @param {object} product - The product object.
     * @param {string} product.id - Product ID.
     * @param {string} product.name - Product Name.
     * @param {number} product.price - Product Price.
     * @param {string} product.img - Product Image URL.
     */
    const addToCart = ({ id, name, price, img }) => {
        if (!id || typeof id !== 'string' || id.trim() === '' ||
            !name || typeof name !== 'string' || name.trim() === '' ||
            typeof price !== 'number' || isNaN(price) || price < 0 ||
            typeof img !== 'string') {
            console.error(`Invalid product data for addToCart:`, { id, name, price, img });
            showToast(`Données produit invalides pour ${name || 'cet article'}.`, 'error');
            return;
        }

        const existingItemIndex = findCartItemIndex(id);

        if (existingItemIndex > -1) {
            const currentQuantity = cart[existingItemIndex].quantity;
            const newQuantity = currentQuantity + 1;
            if (newQuantity <= config.maxQuantityPerItem) {
                cart[existingItemIndex].quantity = newQuantity;
                showToast(`${name} (Quantité : ${newQuantity}) mis à jour dans le panier.`, 'success');
            } else {
                showToast(`Quantité maximale (${config.maxQuantityPerItem}) atteinte pour ${name}.`, 'warning');
                return;
            }
        } else {
            if (1 <= config.maxQuantityPerItem) {
                cart.push({ id, name, price, quantity: 1, img });
                showToast(`${name} ajouté au panier !`, 'success');
            } else {
                showToast(`Impossible d'ajouter ${name} (Quantité max : ${config.maxQuantityPerItem}).`, 'warning');
                return;
            }
        }
        updateCartStateAndUI();
    };

    /**
     * Updates the quantity of a specific item in the cart.
     * @param {string} id - The ID of the item to update.
     * @param {number} newQuantityInput - The desired new quantity.
     */
    const updateQuantity = (id, newQuantityInput) => {
        const itemIndex = findCartItemIndex(id);
        if (itemIndex === -1) {
            console.warn(`Attempted to update quantity for non-existent item ID: ${id}`);
            showToast("Erreur lors de la mise à jour de la quantité.", 'error');
            return;
        }

        const quantity = Math.floor(Number(newQuantityInput));
        if (isNaN(quantity)) {
            showToast("Quantité invalide.", 'warning');
            updateCartUI(); // Refresh UI to show the old value
            return;
        }

        const validatedQuantity = Math.max(0, Math.min(quantity, config.maxQuantityPerItem));
        const currentItemName = cart[itemIndex].name;

        if (validatedQuantity === 0) {
            cart.splice(itemIndex, 1);
            showToast(`${currentItemName} supprimé du panier.`, 'info');
        } else {
            cart[itemIndex].quantity = validatedQuantity;
            if (quantity > config.maxQuantityPerItem) {
                showToast(`Quantité limitée à ${config.maxQuantityPerItem} pour ${currentItemName}.`, 'warning');
            } else if (quantity < 0) {
                 // Should not happen due to Math.max(0, ...)
            }
        }
        updateCartStateAndUI();
    };

    /**
     * Removes an item completely from the cart.
     * @param {string} id - The ID of the item to remove.
     */
    const removeFromCart = (id) => {
        const itemIndex = findCartItemIndex(id);
        if (itemIndex > -1) {
            const removedItemName = cart[itemIndex].name;
            cart.splice(itemIndex, 1);
            updateCartStateAndUI();
            showToast(`${removedItemName} supprimé du panier.`, 'info');
        } else {
            console.warn(`Attempted to remove non-existent item ID: ${id}`);
            showToast("Erreur : Article non trouvé pour la suppression.", 'error');
        }
    };

    /**
     * Clears all items from the cart.
     */
    const clearCart = () => {
        if (cart.length > 0) {
            cart = [];
            updateCartStateAndUI();
            showToast('Panier vidé.', 'info');
        } else {
            showToast('Le panier est déjà vide.', 'info');
        }
    };

    // --- UI Update Functions ---

    /**
     * Updates the cart count badge visibility and text content.
     * Targets ALL elements matching the selector class.
     * @param {number} totalItems - The total number of individual items in the cart.
     */
    const updateCartBadge = (totalItems) => {
        // MODIFIÉ ICI: Utilise querySelectorAll avec la classe
        const badgeElements = document.querySelectorAll(config.selectors.cartCountBadge);

        if (badgeElements.length > 0) {
            const displayCount = Math.max(0, Math.floor(totalItems));

            // MODIFIÉ ICI: Itère sur tous les badges trouvés
            badgeElements.forEach(badgeElement => {
                if (displayCount > 0) {
                    badgeElement.textContent = displayCount;
                    // Assurez-vous que le style correspond à celui défini dans le CSS pour les badges visibles
                    badgeElement.style.display = 'flex';
                } else {
                    badgeElement.textContent = '0'; // Mettre à 0 même si caché
                    badgeElement.style.display = 'none';
                }
            });
        } else {
            // Avertissement si aucun élément badge n'est trouvé (cela peut arriver au chargement initial)
            // console.warn(`updateCartBadge: No badge elements found with selector '${config.selectors.cartCountBadge}'.`);
        }
    };


    /**
     * Generates the HTML for a single cart item.
     * @param {object} item - The cart item object.
     * @returns {string} HTML string for the cart item, or empty string if item is invalid.
     */
    const createCartItemHTML = (item) => {
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.price !== 'number' || isNaN(item.price) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || typeof item.img !== 'string') {
            console.error("Invalid item data passed to createCartItemHTML:", item);
            return '';
        }

        const itemTotalPrice = item.price * item.quantity;
        const safeName = item.name.replace(/</g, "<").replace(/>/g, ">");
        const safeImg = item.img; // Assuming img URLs are safe

        // Utilise les sélecteurs de classe sans le point initial pour les ajouter aux éléments HTML
        const quantityDecreaseClass = config.selectors.quantityDecreaseBtnClass.substring(1);
        const quantityInputClass = config.selectors.quantityInputClass.substring(1);
        const quantityIncreaseClass = config.selectors.quantityIncreaseBtnClass.substring(1);
        const removeFromCartClass = config.selectors.removeFromCartBtnClass.substring(1);

        return `
            <div class="${config.htmlClasses.cartItem} d-flex flex-column flex-md-row align-items-md-center mb-3 border-bottom pb-3" data-item-id="${item.id}">
                <img src="${safeImg}" alt="${safeName}" class="img-fluid rounded me-md-3 mb-2 mb-md-0" style="width: 80px; height: 80px; object-fit: contain;" loading="lazy">

                <div class="flex-grow-1 mb-2 mb-md-0 text-center text-md-start">
                    <h6 class="mb-1 cart-item-name">${safeName}</h6>
                    <small class="text-muted cart-item-price">${formatCurrency(item.price)} unitaire</small>
                </div>

                <div class="d-flex align-items-center justify-content-center mx-md-3 mb-2 mb-md-0" style="flex-shrink: 0;">
                    <button class="btn btn-sm btn-outline-secondary ${quantityDecreaseClass}" data-id="${item.id}" aria-label="Diminuer quantité">-</button>
                    <input type="number" class="form-control form-control-sm ${quantityInputClass} mx-1 text-center" value="${item.quantity}" min="1" max="${config.maxQuantityPerItem}" data-id="${item.id}" aria-label="Quantité" style="width: 60px;">
                    <button class="btn btn-sm btn-outline-secondary ${quantityIncreaseClass}" data-id="${item.id}" aria-label="Augmenter quantité">+</button>
                </div>

                <div class="text-center text-md-end me-md-3 mb-2 mb-md-0" style="min-width: 100px; flex-shrink: 0;">
                    <span class="fw-bold cart-item-total">${formatCurrency(itemTotalPrice)}</span>
                </div>

                <button class="btn btn-sm btn-outline-danger ${removeFromCartClass} align-self-center align-self-md-auto" data-id="${item.id}" title="Supprimer ${safeName}">
                    <i class="bi ${config.icons.remove} d-none d-md-inline"></i> <span class="d-inline d-md-none">Supprimer</span><span class="d-none d-md-inline"></span>
                </button>
            </div>
        `;
    };

    /**
     * Updates the WhatsApp order button link and state (enabled/disabled).
     * @param {number} totalPrice - The total price of the cart.
     */
    const updateWhatsAppLink = (totalPrice) => {
        if (!dom.whatsappOrderBtn) return;

        if (cart.length === 0) {
            dom.whatsappOrderBtn.classList.add(config.htmlClasses.disabled);
            dom.whatsappOrderBtn.removeAttribute('href');
            dom.whatsappOrderBtn.setAttribute('aria-disabled', 'true');
            dom.whatsappOrderBtn.removeAttribute('target');
            dom.whatsappOrderBtn.removeAttribute('rel');
        } else {
            let message = "Bonjour Trusttec,\n\nJe souhaite commander les articles suivants :\n";
            cart.forEach(item => {
                if (item && item.name && typeof item.quantity === 'number' && typeof item.price === 'number') {
                    message += `\n- ${item.name}\n  (Quantité : ${item.quantity}) = ${formatCurrency(item.price * item.quantity)}`;
                }
            });
            message += `\n\n--------------------\n*Total de la commande : ${formatCurrency(totalPrice)}*`;
            message += "\n--------------------\n\nMerci de me confirmer la disponibilité et les modalités (paiement/livraison/retrait).";

            const encodedMessage = encodeURIComponent(message);
            const whatsappUrl = `https://wa.me/${config.whatsappNumber}?text=${encodedMessage}`;

            dom.whatsappOrderBtn.classList.remove(config.htmlClasses.disabled);
            dom.whatsappOrderBtn.href = whatsappUrl;
            dom.whatsappOrderBtn.setAttribute('aria-disabled', 'false');
            dom.whatsappOrderBtn.setAttribute('target', '_blank');
            dom.whatsappOrderBtn.setAttribute('rel', 'noopener noreferrer');
        }
    };

    /**
     * Renders the cart items in the modal, updates totals, and manages empty cart state.
     */
    const displayCart = () => {
        if (!dom.cartItemsContainer || !dom.cartTotalPriceEl || !dom.cartEmptyMsg) {
            console.error("Cannot display cart: Modal DOM elements missing.");
            return;
        }

        dom.cartItemsContainer.innerHTML = '';

        if (cart.length === 0) {
            dom.cartEmptyMsg.style.display = 'block';
            dom.cartItemsContainer.style.display = 'none';
            dom.cartTotalPriceEl.textContent = formatCurrency(0);
            updateWhatsAppLink(0);
            if (dom.clearCartBtn) dom.clearCartBtn.classList.add(config.htmlClasses.disabled);
        } else {
            dom.cartEmptyMsg.style.display = 'none';
            dom.cartItemsContainer.style.display = 'block';
            let fragment = document.createDocumentFragment();
            let currentTotalPrice = 0;

            cart.forEach(item => {
                if (item && typeof item.price === 'number' && !isNaN(item.price) && typeof item.quantity === 'number' && item.quantity > 0) {
                    const itemHTML = createCartItemHTML(item);
                    if (itemHTML) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = itemHTML.trim(); // Use trim() for safety
                        if (tempDiv.firstChild) {
                            fragment.appendChild(tempDiv.firstChild);
                            currentTotalPrice += item.price * item.quantity;
                        } else {
                            console.error("Failed to parse item HTML for:", item);
                        }
                    }
                } else {
                    console.error(`Invalid item detected during rendering: ${JSON.stringify(item)}. Skipping.`);
                     // Potentially remove invalid item here carefully
                }
            });

            dom.cartItemsContainer.appendChild(fragment);
            dom.cartTotalPriceEl.textContent = formatCurrency(currentTotalPrice);
            updateWhatsAppLink(currentTotalPrice);
            if (dom.clearCartBtn) dom.clearCartBtn.classList.remove(config.htmlClasses.disabled);
        }
    };

    /**
     * Updates the entire UI based on the current cart state (badge and modal if open).
     */
    const updateCartUI = () => {
        const { totalItems, totalPrice } = calculateCartTotals();
        updateCartBadge(totalItems); // Met à jour tous les badges
        updateWhatsAppLink(totalPrice);

        if (dom.clearCartBtn) {
            if (cart.length === 0) {
                dom.clearCartBtn.classList.add(config.htmlClasses.disabled);
                dom.clearCartBtn.setAttribute('aria-disabled', 'true');
            } else {
                dom.clearCartBtn.classList.remove(config.htmlClasses.disabled);
                dom.clearCartBtn.setAttribute('aria-disabled', 'false');
            }
        }

        // Refresh modal content ONLY if it's currently shown
        if (dom.cartModalElement && dom.cartModalElement.classList.contains(config.htmlClasses.modalShow)) {
            displayCart();
        }
    };


    // --- Toast Notification System ---
    /**
     * Creates the toast container element if it doesn't exist.
     * @returns {HTMLElement | null} The toast container element, or null if body doesn't exist.
     */
    const getOrCreateToastContainer = () => {
        if (!dom.body) {
            console.error("Cannot create toast container: document.body not found.");
            return null;
        }
        let container = document.getElementById(config.selectors.toastContainerId);
        if (!container) {
            container = document.createElement('div');
            container.id = config.selectors.toastContainerId;
            container.className = `toast-container ${config.htmlClasses.toastContainerPosition}`;
            container.style.zIndex = '1100';
            dom.body.appendChild(container);
        }
        return container;
    };

    /**
     * Shows a Bootstrap toast notification.
     * @param {string} message - The message to display.
     * @param {'success' | 'error' | 'warning' | 'info'} type - Type of toast (affects style). Defaults to 'info'.
     */
    const showToast = (message, type = 'info') => {
        const toastContainer = getOrCreateToastContainer();
        if (!toastContainer) return;

        const toastId = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        let bgClass = config.htmlClasses.bgInfo;
        let iconClass = config.icons.info;
        let ariaRole = 'status';

        switch (type) {
            case 'success':
                bgClass = config.htmlClasses.bgSuccess; iconClass = config.icons.success; break;
            case 'error':
                bgClass = config.htmlClasses.bgError; iconClass = config.icons.error; ariaRole = 'alert'; break;
            case 'warning':
                bgClass = config.htmlClasses.bgWarning; iconClass = config.icons.warning; ariaRole = 'alert'; break;
        }

        const safeMessage = message.replace(/</g, "<").replace(/>/g, ">");

        const toastHTML = `
            <div id="${toastId}" class="${config.htmlClasses.toastBase} ${config.htmlClasses.toastAlignItems} ${bgClass} ${config.htmlClasses.toastBorder}" role="${ariaRole}" aria-live="${ariaRole === 'alert' ? 'assertive' : 'polite'}" aria-atomic="true" data-bs-delay="${config.toastDisplayTime}">
                <div class="d-flex">
                    <div class="${config.htmlClasses.toastBody}">
                       <i class="bi ${iconClass} me-2" aria-hidden="true"></i> ${safeMessage}
                    </div>
                    <button type="button" class="${config.htmlClasses.toastDismissButton} ${config.htmlClasses.toastDismissButtonWhite} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;

        toastContainer.insertAdjacentHTML('beforeend', toastHTML);

        const toastElement = document.getElementById(toastId);
        if (!toastElement) {
            console.error("Failed to find newly created toast element in the DOM.");
            return;
        }

        try {
            const toastInstance = new bootstrap.Toast(toastElement, {
                delay: config.toastDisplayTime
            });
            toastElement.addEventListener('hidden.bs.toast', () => {
                toastElement.remove();
            }, { once: true });
            toastInstance.show();
        } catch (error) {
            console.error("Error initializing or showing Bootstrap toast:", error);
            if (toastElement) toastElement.remove();
        }
    };


    // --- Event Handlers ---

    /**
     * Handles clicks on "Add to Cart" buttons anywhere on the page.
     * @param {Event} event - The click event object.
     */
    const handleAddToCartClick = (event) => {
        const addButton = event.target.closest(config.selectors.addToCartBtnClass);
        if (!addButton) return;
        event.preventDefault();

        const { id, name, price, img } = addButton.dataset;

        if (!id || !name || price === undefined || !img) {
            console.error("Product data missing or invalid on 'Add to Cart' button:", addButton.dataset, addButton);
            showToast("Impossible d'ajouter le produit (données manquantes ou invalides).", 'error');
            return;
        }

        const numericPrice = parseFloat(price);
        if (isNaN(numericPrice) || numericPrice < 0) {
            console.error(`Invalid price format or value on button for product ${id}: ${price}`);
            showToast("Impossible d'ajouter le produit (prix invalide).", 'error');
            return;
        }

        addToCart({ id: String(id), name: String(name), price: numericPrice, img: String(img) });
    };

    /**
     * Handles interactions within the cart items container.
     * @param {Event} event - The event object.
     */
    const handleCartInteraction = (event) => {
        const target = event.target;

        // Utilisation directe des sélecteurs de classe de la config
        const decreaseBtn = target.closest(config.selectors.quantityDecreaseBtnClass);
        const increaseBtn = target.closest(config.selectors.quantityIncreaseBtnClass);
        const removeBtn = target.closest(config.selectors.removeFromCartBtnClass);
        const quantityInput = target.matches(config.selectors.quantityInputClass) ? target : null;

        const itemId = decreaseBtn?.dataset.id || increaseBtn?.dataset.id || removeBtn?.dataset.id || quantityInput?.dataset.id;

        if (!itemId) return;

        const currentItem = cart.find(item => item.id === itemId);
        if (!currentItem && (decreaseBtn || increaseBtn || removeBtn || quantityInput)) {
            console.warn(`Interaction on item ID ${itemId} which is not in the cart state. Refreshing UI.`);
            showToast("Erreur : article non trouvé dans le panier.", "error");
            updateCartUI();
            return;
        }

        if (decreaseBtn && event.type === 'click') {
            if (currentItem) updateQuantity(itemId, currentItem.quantity - 1);
        } else if (increaseBtn && event.type === 'click') {
            if (currentItem) updateQuantity(itemId, currentItem.quantity + 1);
        } else if (removeBtn && event.type === 'click') {
            removeFromCart(itemId);
        } else if (quantityInput && event.type === 'change') {
            const newQuantity = parseInt(quantityInput.value, 10);
            if (!isNaN(newQuantity)) {
                updateQuantity(itemId, newQuantity);
            } else {
                if (currentItem) quantityInput.value = currentItem.quantity;
                else quantityInput.value = 1;
                showToast("Quantité entrée invalide.", 'warning');
            }
        }
    };

    /**
     * Prevents mouse wheel scroll from changing number input values within the cart.
     * @param {Event} event - The wheel event.
     */
    const handleNumberInputWheel = (event) => {
        // Cible les inputs de type number DANS le conteneur du panier
        const input = event.target.closest(`${config.selectors.cartItemsContainer} input[type="number"]`);
        if (input && document.activeElement === input) {
            event.preventDefault();
            input.blur();
        }
    };


    // --- Initialization ---

    /**
     * Attaches all necessary event listeners.
     */
    const initializeEventListeners = () => {
        dom.body.addEventListener('click', handleAddToCartClick);

        if (dom.cartItemsContainer) {
            dom.cartItemsContainer.addEventListener('click', handleCartInteraction);
            dom.cartItemsContainer.addEventListener('change', handleCartInteraction);
            // Empêcher la molette de la souris sur les inputs number DANS le panier
            dom.cartItemsContainer.addEventListener('wheel', handleNumberInputWheel, { passive: false });
        } else {
            console.warn("Cart items container not found. Cart interaction listeners not attached.");
        }

        if (dom.clearCartBtn) {
            dom.clearCartBtn.addEventListener('click', clearCart);
        } else {
            console.warn("Clear Cart button not found. Listener not attached.");
        }

        if (dom.cartModalElement) {
            dom.cartModalElement.addEventListener('show.bs.modal', displayCart);
            // dom.cartModalElement.addEventListener('shown.bs.modal', () => { /* Focus management */ });
        } else {
            console.warn("Cart modal element not found. Listener not attached.");
        }

        window.addEventListener('storage', (event) => {
            if (event.key === config.localStorageKey && event.oldValue !== event.newValue) {
                console.log('Cart updated in another tab/window. Reloading...');
                const previousCartLength = cart.length;
                cart = loadCartFromStorage();
                if (cart.length !== previousCartLength || JSON.stringify(cart) !== event.newValue) {
                     showToast('Contenu du panier mis à jour depuis un autre onglet.', 'info');
                }
                updateCartUI();
            }
        });
    };

    /**
     * Initializes the cart system.
     */
    const initializeCart = () => {
        cart = loadCartFromStorage();
        initializeEventListeners();
        updateCartUI(); // Met à jour l'UI initiale (y compris tous les badges)
        console.log(`Trusttec Cart Initialized (v2.1.1). ${cart.length} item(s) loaded.`);
    };

    // --- Start the application ---
    if (typeof bootstrap !== 'undefined' && typeof bootstrap.Modal !== 'undefined' && typeof bootstrap.Toast !== 'undefined') {
        initializeCart();
    } else {
        console.error("FATAL: Bootstrap 5 JavaScript (Modal, Toast) not found or not fully loaded. Cart functionality depends on it.");
        document.querySelectorAll(config.selectors.cartIcon).forEach(icon => {
            if (icon) icon.style.display = 'none';
        });
    }

}); // End DOMContentLoaded
