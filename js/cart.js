/**
 * @fileoverview Shopping Cart functionality for Trusttec website.
 * Handles adding items, updating quantities, removing items, displaying the cart,
 * saving to localStorage, generating a WhatsApp order, and showing notifications.
 * Relies on Bootstrap 5 for modal and toast components.
 *
 * @version 2.1.0
 * @author Your Name/Trusttec Dev Team
 * @description Version 2.1.0 removes confirmation dialogs for clearing cart and removing items.
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
            cartCountBadge: '#cart-count-badge', // ID utilisé sur les deux badges (mobile/desktop)
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
        // If needed, use querySelectorAll and iterate if actions depend on ALL cart icons.
        // For the badge, we'll stick to getElementById for now, assuming it finds the visible one.
        cartIcon: document.querySelector(config.selectors.cartIcon), // Selects the first match
        cartCountBadge: document.getElementById(config.selectors.cartCountBadge.substring(1)), // Remove '#' for getElementById
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
        // Optionally disable cart features visually if elements are missing
        if (dom.cartIcon) {
            // If multiple icons exist, hide all
            document.querySelectorAll(config.selectors.cartIcon).forEach(icon => icon.style.display = 'none');
        }
        return; // Stop script execution if core elements are missing
    }
    // Check specifically for the badge, as it's crucial for visual feedback
     if (!dom.cartCountBadge) {
         console.warn("Cart count badge element not found. Badge updates will not work.");
         // Don't return, cart can still function, just without the visual count
     }


    // --- State ---
    let cart = []; // Initialize cart state

    // --- Helper Functions ---

    /**
     * Formats a number as currency according to configuration.
     * @param {number} value - The number to format.
     * @returns {string} Formatted currency string.
     */
    const formatCurrency = (value) => {
        // Ensure value is a number before formatting
        if (typeof value !== 'number' || isNaN(value)) {
            console.warn(`formatCurrency received non-numeric value: ${value}. Returning 'N/A'.`);
            return 'N/A'; // Or formatCurrency(0) or an empty string
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
            // Basic validation: Check if it's an array
            if (!Array.isArray(parsedCart)) {
                 console.warn('Invalid cart data found in localStorage. Resetting cart.');
                 return [];
            }
            // Deeper validation: check if items have required properties and valid values
             return parsedCart.filter(item =>
                item && typeof item.id === 'string' && item.id.trim() !== '' &&
                typeof item.name === 'string' && item.name.trim() !== '' &&
                typeof item.price === 'number' && !isNaN(item.price) && item.price >= 0 && // Price should be non-negative
                typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0 && // Quantity must be positive integer
                typeof item.img === 'string' // Allow empty string for img? Decide based on requirements.
            );

        } catch (error) {
            console.error("Error loading cart from localStorage:", error);
            // Clear potentially corrupted storage
            localStorage.removeItem(config.localStorageKey);
            return []; // Return empty cart on error
        }
    };

    /**
     * Safely saves the cart to localStorage.
     */
    const saveCartToStorage = () => {
        try {
            // Ensure cart contains only valid items before saving
            const validCart = cart.filter(item =>
                item && typeof item.id === 'string' && item.id.trim() !== '' &&
                typeof item.name === 'string' && item.name.trim() !== '' &&
                typeof item.price === 'number' && !isNaN(item.price) && item.price >= 0 &&
                typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0 &&
                typeof item.img === 'string'
            );
            if (validCart.length !== cart.length) {
                console.warn("Attempted to save invalid items to cart. Only valid items were saved.");
                cart = validCart; // Update in-memory cart to match what's saved
            }
            localStorage.setItem(config.localStorageKey, JSON.stringify(validCart));
        } catch (error) {
            console.error("Error saving cart to localStorage:", error);
            // Optionally notify the user if storage fails (e.g., quota exceeded)
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
            // Add extra check for valid item structure during calculation
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
     * Central point for triggering saves and UI refreshes after cart modifications.
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
     * @param {number} product.price - Product Price (should already be a number).
     * @param {string} product.img - Product Image URL.
     */
    const addToCart = ({ id, name, price, img }) => {
         // Input validation
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
            // Item exists, increase quantity (respecting max limit)
            const currentQuantity = cart[existingItemIndex].quantity;
            const newQuantity = currentQuantity + 1;
            if (newQuantity <= config.maxQuantityPerItem) {
                 cart[existingItemIndex].quantity = newQuantity;
                 showToast(`${name} (Quantité : ${newQuantity}) mis à jour dans le panier.`, 'success');
            } else {
                 showToast(`Quantité maximale (${config.maxQuantityPerItem}) atteinte pour ${name}.`, 'warning');
                 return; // Don't update state or UI if limit reached
            }
        } else {
            // Add new item, ensure quantity is within limits (should be 1 here, but check anyway)
             if (1 <= config.maxQuantityPerItem) {
                 cart.push({ id, name, price, quantity: 1, img });
                 showToast(`${name} ajouté au panier !`, 'success');
             } else {
                 showToast(`Impossible d'ajouter ${name} (Quantité max : ${config.maxQuantityPerItem}).`, 'warning');
                 return; // Don't update state or UI if limit reached
             }
        }

        updateCartStateAndUI();
    };

    /**
     * Updates the quantity of a specific item in the cart.
     * Removes the item if the new quantity is 0 or less.
     * @param {string} id - The ID of the item to update.
     * @param {number} newQuantityInput - The desired new quantity (potentially non-integer or out of bounds).
     */
    const updateQuantity = (id, newQuantityInput) => {
        const itemIndex = findCartItemIndex(id);
        if (itemIndex === -1) {
            console.warn(`Attempted to update quantity for non-existent item ID: ${id}`);
            showToast("Erreur lors de la mise à jour de la quantité.", 'error');
            return;
        }

        // Validate and sanitize quantity: ensure it's an integer, >= 0, <= maxQuantityPerItem
        const quantity = Math.floor(Number(newQuantityInput)); // Ensure integer
        if (isNaN(quantity)) {
            showToast("Quantité invalide.", 'warning');
            // Optionally reset input field value to previous valid quantity
            updateCartUI(); // Refresh UI to show the old value in the input
            return;
        }

        const validatedQuantity = Math.max(0, Math.min(quantity, config.maxQuantityPerItem));
        const currentItemName = cart[itemIndex].name; // Get name for toasts

        if (validatedQuantity === 0) {
            // Remove item if quantity becomes 0
            cart.splice(itemIndex, 1);
            showToast(`${currentItemName} supprimé du panier.`, 'info');
        } else {
            cart[itemIndex].quantity = validatedQuantity;
             // Notify if quantity was capped (and different from original input)
            if (quantity > config.maxQuantityPerItem) {
                 showToast(`Quantité limitée à ${config.maxQuantityPerItem} pour ${currentItemName}.`, 'warning');
            } else if (quantity < 0) {
                 // This case should technically not happen due to Math.max(0, ...)
                 // but if it did, we'd remove the item (handled by validatedQuantity === 0 check).
            } else {
                // Quantity updated successfully within bounds (or was already 0 and item removed)
                // No specific toast needed here unless you want verbose feedback on every change.
                // A general "Cart updated" toast might be too noisy.
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
            const removedItemName = cart[itemIndex].name; // Get name before removing
            cart.splice(itemIndex, 1);
            updateCartStateAndUI();
            showToast(`${removedItemName} supprimé du panier.`, 'info'); // Use 'info'
        } else {
             console.warn(`Attempted to remove non-existent item ID: ${id}`);
             showToast("Erreur : Article non trouvé pour la suppression.", 'error');
        }
    };

    /**
     * Clears all items from the cart. (Confirmation removed as requested)
     */
    const clearCart = () => {
        if (cart.length > 0) { // Only act if the cart is not already empty
            cart = [];
            updateCartStateAndUI();
            showToast('Panier vidé.', 'info');
            // Optional: Close modal after clearing
            // const modalInstance = bootstrap.Modal.getInstance(dom.cartModalElement);
            // if (modalInstance) {
            //    modalInstance.hide();
            // }
        } else {
            // Optionally show a message if the cart was already empty
            showToast('Le panier est déjà vide.', 'info');
        }
    };

    // --- UI Update Functions ---

    /**
     * Updates the cart count badge visibility and text content.
     * Targets the element by ID, assuming only one is effectively visible/relevant at a time.
     * @param {number} totalItems - The total number of individual items in the cart.
     */
    const updateCartBadge = (totalItems) => {
        // Re-select the badge element each time in case the DOM changes (mobile/desktop swap)
        // Using getElementById should be fine as IDs must be unique per document,
        // even if one element with the ID is hidden.
        const badgeElement = document.getElementById(config.selectors.cartCountBadge.substring(1));

        if (badgeElement) {
            // Ensure totalItems is a non-negative integer
            const displayCount = Math.max(0, Math.floor(totalItems));

            if (displayCount > 0) {
                badgeElement.textContent = displayCount;
                badgeElement.style.display = 'flex'; // Use 'flex' as per CSS style
            } else {
                badgeElement.textContent = '0'; // Set to 0 even when hidden for consistency
                badgeElement.style.display = 'none';
            }
        } else {
             // Log warning if the badge wasn't found during an update attempt
             console.warn(`updateCartBadge: Badge element with ID '${config.selectors.cartCountBadge}' not found.`);
        }
    };

    /**
     * Generates the HTML for a single cart item.
     * @param {object} item - The cart item object.
     * @returns {string} HTML string for the cart item, or empty string if item is invalid.
     */
    const createCartItemHTML = (item) => {
         // Validate item before creating HTML
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.price !== 'number' || isNaN(item.price) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || typeof item.img !== 'string') {
            console.error("Invalid item data passed to createCartItemHTML:", item);
            return ''; // Return empty string for invalid items
        }

        const itemTotalPrice = item.price * item.quantity;
        // Basic escaping for name and alt text (prevent XSS)
         const safeName = item.name.replace(/</g, "<").replace(/>/g, ">"); // More standard escaping
        // Assuming img URLs are safe, but could add validation/sanitization if needed
        const safeImg = item.img;

        // Using template literals for cleaner HTML structure
        return `
            <div class="${config.htmlClasses.cartItem} d-flex flex-column flex-md-row align-items-md-center mb-3 border-bottom pb-3" data-item-id="${item.id}">
                <img src="${safeImg}" alt="${safeName}" class="img-fluid rounded me-md-3 mb-2 mb-md-0" style="width: 80px; height: 80px; object-fit: contain;" loading="lazy">

                <div class="flex-grow-1 mb-2 mb-md-0 text-center text-md-start">
                    <h6 class="mb-1 cart-item-name">${safeName}</h6>
                    <small class="text-muted cart-item-price">${formatCurrency(item.price)} unitaire</small>
                </div>

                <div class="d-flex align-items-center justify-content-center mx-md-3 mb-2 mb-md-0" style="flex-shrink: 0;">
                    <button class="btn btn-sm btn-outline-secondary ${config.selectors.quantityDecreaseBtnClass.substring(1)}" data-id="${item.id}" aria-label="Diminuer quantité">-</button>
                    <input type="number" class="form-control form-control-sm ${config.selectors.quantityInputClass.substring(1)} mx-1 text-center" value="${item.quantity}" min="1" max="${config.maxQuantityPerItem}" data-id="${item.id}" aria-label="Quantité" style="width: 60px;">
                    <button class="btn btn-sm btn-outline-secondary ${config.selectors.quantityIncreaseBtnClass.substring(1)}" data-id="${item.id}" aria-label="Augmenter quantité">+</button>
                </div>

                <div class="text-center text-md-end me-md-3 mb-2 mb-md-0" style="min-width: 100px; flex-shrink: 0;">
                    <span class="fw-bold cart-item-total">${formatCurrency(itemTotalPrice)}</span>
                </div>

                <button class="btn btn-sm btn-outline-danger ${config.selectors.removeFromCartBtnClass.substring(1)} align-self-center align-self-md-auto" data-id="${item.id}" title="Supprimer ${safeName}">
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
                // Double check item validity before including in message
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
             dom.whatsappOrderBtn.setAttribute('target', '_blank'); // Open in new tab
             dom.whatsappOrderBtn.setAttribute('rel', 'noopener noreferrer'); // Security best practice
        }
    };

    /**
     * Renders the cart items in the modal, updates totals, and manages empty cart state.
     */
    const displayCart = () => {
        // Ensure container exists
        if (!dom.cartItemsContainer || !dom.cartTotalPriceEl || !dom.cartEmptyMsg) {
             console.error("Cannot display cart: Modal DOM elements missing.");
             return;
         }

        dom.cartItemsContainer.innerHTML = ''; // Clear previous items

        if (cart.length === 0) {
            dom.cartEmptyMsg.style.display = 'block'; // Show empty message
            dom.cartItemsContainer.style.display = 'none'; // Hide the container itself
            dom.cartTotalPriceEl.textContent = formatCurrency(0);
            updateWhatsAppLink(0); // Ensure WhatsApp button is disabled
            // Ensure clear cart button is also disabled visually
            if(dom.clearCartBtn) dom.clearCartBtn.classList.add(config.htmlClasses.disabled);
        } else {
            dom.cartEmptyMsg.style.display = 'none'; // Hide empty message
            dom.cartItemsContainer.style.display = 'block'; // Show the container
            let fragment = document.createDocumentFragment(); // Use fragment for performance
            let currentTotalPrice = 0;

            cart.forEach(item => {
                 // Validate item data again before rendering
                 if (item && typeof item.price === 'number' && !isNaN(item.price) && typeof item.quantity === 'number' && item.quantity > 0) {
                    const itemHTML = createCartItemHTML(item);
                    if (itemHTML) { // Only append if HTML was successfully created
                        const tempDiv = document.createElement('div');
                        // innerHTML on a div is safe for inserting well-formed elements
                        tempDiv.innerHTML = itemHTML.trim();
                        if (tempDiv.firstChild) {
                           fragment.appendChild(tempDiv.firstChild);
                           currentTotalPrice += item.price * item.quantity;
                        } else {
                           console.error("Failed to parse item HTML for:", item);
                        }
                    }
                 } else {
                      console.error(`Invalid item detected during rendering: ${JSON.stringify(item)}. Skipping.`);
                      // Consider removing invalid item from cart state here, carefully
                      // const invalidItemIndex = findCartItemIndex(item?.id);
                      // if (invalidItemIndex > -1) {
                      //     cart.splice(invalidItemIndex, 1);
                      //     // Potentially call saveCartToStorage() or trigger updateCartStateAndUI()
                      //     // but be wary of causing infinite loops if called from within rendering.
                      // }
                 }
            });

            dom.cartItemsContainer.appendChild(fragment);
            dom.cartTotalPriceEl.textContent = formatCurrency(currentTotalPrice);
            updateWhatsAppLink(currentTotalPrice); // Update WhatsApp link with calculated total
             // Ensure clear cart button is enabled
            if(dom.clearCartBtn) dom.clearCartBtn.classList.remove(config.htmlClasses.disabled);
        }
        // Note: Badge update is handled separately by updateCartUI
    };


    /**
     * Updates the entire UI based on the current cart state (badge and modal if open).
     */
    const updateCartUI = () => {
        const { totalItems, totalPrice } = calculateCartTotals(); // Calculate totals once
        updateCartBadge(totalItems); // Update the badge count (targets the visible one by ID)

        // Update WhatsApp button state regardless of modal visibility
        updateWhatsAppLink(totalPrice);

        // Enable/disable Clear Cart button based on whether the cart has items
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
        // Use Bootstrap's check for modal visibility for robustness
        const modalInstance = bootstrap.Modal.getInstance(dom.cartModalElement);
        // Check if the modal element exists AND has the 'show' class
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
            // Ensure classes are applied correctly
            container.className = `toast-container ${config.htmlClasses.toastContainerPosition}`;
            container.style.zIndex = '1100'; // Ensure z-index is high
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
        if (!toastContainer) return; // Exit if container couldn't be created

        const toastId = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`; // More unique ID

        let bgClass = config.htmlClasses.bgInfo;
        let iconClass = config.icons.info;
        let ariaRole = 'status'; // Default role

        switch (type) {
            case 'success':
                bgClass = config.htmlClasses.bgSuccess;
                iconClass = config.icons.success;
                break;
            case 'error':
                bgClass = config.htmlClasses.bgError;
                iconClass = config.icons.error;
                ariaRole = 'alert'; // Use alert role for errors
                break;
            case 'warning':
                bgClass = config.htmlClasses.bgWarning;
                iconClass = config.icons.warning;
                ariaRole = 'alert'; // Use alert role for warnings
                break;
             // Default is info, already set
        }

        // Sanitize message - basic HTML entity encoding
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

        // Use insertAdjacentHTML for efficiency
        toastContainer.insertAdjacentHTML('beforeend', toastHTML);

        const toastElement = document.getElementById(toastId);
        if (!toastElement) {
            console.error("Failed to find newly created toast element in the DOM.");
            return;
        }

        // Get the Bootstrap Toast instance
        try {
            const toastInstance = new bootstrap.Toast(toastElement, {
                 delay: config.toastDisplayTime // Pass delay here too
            });

            // Add event listener to remove the element from DOM after it's hidden
            toastElement.addEventListener('hidden.bs.toast', () => {
                 toastElement.remove();
            }, { once: true }); // Use { once: true } for automatic listener cleanup

            toastInstance.show();
        } catch (error) {
            console.error("Error initializing or showing Bootstrap toast:", error);
            // Fallback or cleanup
            if (toastElement) toastElement.remove();
        }
    };


    // --- Event Handlers ---

    /**
     * Handles clicks on "Add to Cart" buttons anywhere on the page.
     * Uses event delegation on the body.
     * @param {Event} event - The click event object.
     */
    const handleAddToCartClick = (event) => {
        // Find the closest button element matching the selector, even if the click was on an icon inside it
        const addButton = event.target.closest(config.selectors.addToCartBtnClass);
        if (!addButton) return; // Click was not on or inside an add button

        event.preventDefault(); // Prevent default button/link behavior

        // Retrieve product data from data-* attributes
        const { id, name, price, img } = addButton.dataset;

        // Validate required data
        if (!id || !name || price === undefined || !img) { // Allow price to be 0, check for undefined
            console.error("Product data missing or invalid on 'Add to Cart' button:", addButton.dataset, addButton);
            showToast("Impossible d'ajouter le produit (données manquantes ou invalides).", 'error');
            return;
        }

        // Convert price to number safely
        const numericPrice = parseFloat(price);
        if (isNaN(numericPrice) || numericPrice < 0) { // Price cannot be negative
            console.error(`Invalid price format or value on button for product ${id}: ${price}`);
             showToast("Impossible d'ajouter le produit (prix invalide).", 'error');
            return;
        }

        addToCart({ id: String(id), name: String(name), price: numericPrice, img: String(img) });
    };

    /**
     * Handles interactions within the cart items container (increase, decrease, remove, input change).
     * Uses event delegation.
     * @param {Event} event - The event object (e.g., click, change, input).
     */
    const handleCartInteraction = (event) => {
        const target = event.target;

        // Determine the action based on the clicked/changed element and its classes/type
        const decreaseBtn = target.closest(config.selectors.quantityDecreaseBtnClass);
        const increaseBtn = target.closest(config.selectors.quantityIncreaseBtnClass);
        const removeBtn = target.closest(config.selectors.removeFromCartBtnClass);
        const quantityInput = target.matches(config.selectors.quantityInputClass) ? target : null; // Direct match for input

        // Find the associated item ID from the data-id attribute on the interactive element or its parent cart item
        const itemId = decreaseBtn?.dataset.id || increaseBtn?.dataset.id || removeBtn?.dataset.id || quantityInput?.dataset.id;

        if (!itemId) return; // Interaction wasn't on a relevant element with a data-id

        const currentItem = cart.find(item => item.id === itemId);
        if (!currentItem && (decreaseBtn || increaseBtn || removeBtn || quantityInput)) {
             // Item not found in cart state, but interaction happened. This suggests an inconsistency.
             console.warn(`Interaction on item ID ${itemId} which is not in the cart state. Refreshing UI.`);
             showToast("Erreur : article non trouvé dans le panier.", "error");
             updateCartUI(); // Refresh UI to reflect actual cart state
             return;
        }

        // --- Handle specific actions ---

        // Quantity Decrease (-) Button Click
        if (decreaseBtn && event.type === 'click') {
            if(currentItem) { // Check item exists before accessing quantity
                 updateQuantity(itemId, currentItem.quantity - 1);
            }
        }
        // Quantity Increase (+) Button Click
        else if (increaseBtn && event.type === 'click') {
             if(currentItem) { // Check item exists
                 updateQuantity(itemId, currentItem.quantity + 1);
            }
        }
        // Remove from Cart (Trashcan) Button Click (Confirmation removed)
        else if (removeBtn && event.type === 'click') {
             removeFromCart(itemId); // Directly remove without confirmation
        }
        // Quantity Input Change (committed value, e.g., on blur or Enter)
        else if (quantityInput && event.type === 'change') {
             const newQuantity = parseInt(quantityInput.value, 10);
             if (!isNaN(newQuantity)) {
                 updateQuantity(itemId, newQuantity); // updateQuantity handles validation (0, max)
             } else {
                 // Invalid input (e.g., text entered), reset to current quantity
                 if(currentItem) { // Check item exists
                     quantityInput.value = currentItem.quantity;
                 } else {
                     quantityInput.value = 1; // Fallback if item somehow missing
                 }
                  showToast("Quantité entrée invalide.", 'warning');
             }
        }
        // Optional: Handle 'input' event for immediate feedback (use debounce/throttle in production)
        // else if (quantityInput && event.type === 'input') {
        //     // Implement debounced update or validation feedback here
        // }
    };


    /**
     * Prevents mouse wheel scroll from changing number input values when focused within the cart.
     * Also handles focus to prevent accidental scrolling page when over input.
     * @param {Event} event - The wheel event.
     */
    const handleNumberInputWheel = (event) => {
        // Check if the target is a number input inside the cart items container
        // More specific selector to ensure it's within the cart modal body
        const input = event.target.closest(`#${config.selectors.cartItemsContainer.substring(1)} input[type="number"]`);

        if (input && document.activeElement === input) {
            // Prevent default scroll-to-change-value behavior
            event.preventDefault();

            // Blur the input to allow page scrolling again
            // This might be slightly jarring, consider alternative UX if needed.
            input.blur();
        }
    };


    // --- Initialization ---

    /**
     * Attaches all necessary event listeners.
     */
    const initializeEventListeners = () => {
        // 1. Add to Cart button clicks (delegated to body for dynamically added buttons)
        dom.body.addEventListener('click', handleAddToCartClick);

        // 2. Interactions within the cart items container (delegated)
        if (dom.cartItemsContainer) {
            // Listen for clicks on specific buttons within the container
            dom.cartItemsContainer.addEventListener('click', handleCartInteraction);
            // Listen for committed changes on quantity inputs
            dom.cartItemsContainer.addEventListener('change', handleCartInteraction);
             // Optional: Listen for 'input' event if real-time feedback is needed (add debounce)
             // dom.cartItemsContainer.addEventListener('input', handleCartInteraction);

            // Prevent mouse wheel scrolling on number inputs within the cart
            dom.cartItemsContainer.addEventListener('wheel', handleNumberInputWheel, { passive: false });
        } else {
             console.warn("Cart items container not found. Cart interaction listeners not attached.");
        }

        // 3. Clear Cart button click
        if (dom.clearCartBtn) {
            dom.clearCartBtn.addEventListener('click', clearCart);
        } else {
            console.warn("Clear Cart button not found. Listener not attached.");
        }

        // 4. Show/Refresh cart when modal is shown
        if (dom.cartModalElement) {
            // Use 'show.bs.modal' to ensure cart is displayed *before* the modal fully appears
            dom.cartModalElement.addEventListener('show.bs.modal', displayCart);
            // Optional: Add listener for 'shown.bs.modal' if focus management inside modal is needed
            // dom.cartModalElement.addEventListener('shown.bs.modal', () => {
            //      // Example: focus first interactive element in the modal body
            //      const firstInteractive = dom.cartModalElement.querySelector(
            //          '.modal-body button:not([disabled]), .modal-body input:not([disabled])'
            //      );
            //      if (firstInteractive) firstInteractive.focus();
            // });
        } else {
             console.warn("Cart modal element not found. Listener not attached.");
        }

         // 5. Listen for storage changes from other tabs/windows
         window.addEventListener('storage', (event) => {
            // Check if the event key matches our cart storage key and the value actually changed
            if (event.key === config.localStorageKey && event.oldValue !== event.newValue) {
                console.log('Cart updated in another tab/window. Reloading...');
                const previousCartLength = cart.length;
                cart = loadCartFromStorage(); // Reload cart state from the updated storage
                 // Check if the cart actually changed significantly before showing a generic toast
                if (cart.length !== previousCartLength || JSON.stringify(cart) !== event.newValue) {
                    showToast('Contenu du panier mis à jour depuis un autre onglet.', 'info');
                }
                updateCartUI(); // Update UI in this tab to reflect the changes
            }
         });
    };

    /**
     * Initializes the cart system.
     */
    const initializeCart = () => {
        cart = loadCartFromStorage(); // Load cart from storage first
        initializeEventListeners();    // Then attach listeners
        updateCartUI();              // Then update the UI based on loaded state (Important: Do this AFTER listeners)
        console.log(`Trusttec Cart Initialized (v2.1.0). ${cart.length} item(s) loaded.`);
    };

    // --- Start the application ---
    // Ensure Bootstrap's JS is loaded before initializing
    if (typeof bootstrap !== 'undefined' && typeof bootstrap.Modal !== 'undefined' && typeof bootstrap.Toast !== 'undefined') {
        initializeCart();
    } else {
        console.error("FATAL: Bootstrap 5 JavaScript (Modal, Toast) not found or not fully loaded. Cart functionality depends on it.");
        // Optionally display a user-facing error message
        // Hide all potential cart icons if Bootstrap is missing
         document.querySelectorAll(config.selectors.cartIcon).forEach(icon => {
             if(icon) icon.style.display = 'none';
         });
    }

}); // End DOMContentLoaded
