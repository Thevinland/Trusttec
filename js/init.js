import { initAuth, buildAuthModal, updateNavAuthUI, onAuthChange } from './auth.js';
import { initChat, sendCartOrderMessage } from './chat.js';

export async function initApp() {
    buildAuthModal();
    await initAuth();
    initChat();
    updateNavAuthUI();
    onAuthChange(() => updateNavAuthUI());

    document.getElementById('chat-order-btn')?.addEventListener('click', async () => {
        const { getUser, showToast } = await import('./auth.js');
        const user = getUser();
        if (!user) {
            new bootstrap.Modal(document.getElementById('authModal')).show();
            return;
        }

        const raw = localStorage.getItem('trusttecCart_v3');
        if (!raw) {
            showToast('Votre panier est vide.', 'warning');
            return;
        }
        let cart;
        try { cart = JSON.parse(raw); } catch { cart = []; }
        if (!cart.length) {
            showToast('Votre panier est vide.', 'warning');
            return;
        }

        const formatPrice = (val) => val.toLocaleString('fr-FR');
        const lines = cart.map((item, i) => {
            const colorText = item.colorName ? ` (${item.colorName})` : '';
            const lineTotal = formatPrice(item.price * item.quantity);
            const price = formatPrice(item.price);
            return `${i + 1}. ${item.name}${colorText} - Prix unitaire: ${price} CFA x ${item.quantity} = ${lineTotal} CFA`;
        });

        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const message = `NOUVELLE COMMANDE\n\n${lines.join('\n')}\n\n\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\x2d\nTOTAL: ${formatPrice(total)} CFA\n\nMerci de traiter cette commande.`;

        const convId = await sendCartOrderMessage(message, 'Nouvelle Commande Panier');
        if (convId) {
            sessionStorage.setItem('chat_active_conv', convId);
        }

        bootstrap.Modal.getInstance(document.getElementById('cartModal'))?.hide();
        document.getElementById('chat-toggle-btn')?.click();
    });


}
