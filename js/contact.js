import { initApp } from './init.js';
import { getUser } from './auth.js';

document.getElementById('current-year').textContent = new Date().getFullYear();

function formatPrice(price) {
    const numericPrice = Number(price);
    if (isNaN(numericPrice)) {
        return 'Prix invalide';
    }
    return numericPrice.toLocaleString('fr-FR', { style: 'currency', currency: 'CFA', minimumFractionDigits: 0, maximumFractionDigits: 0 }).trim();
}

initApp();

document.getElementById('open-chat-btn')?.addEventListener('click', async () => {
    const user = getUser();
    if (!user) {
        new bootstrap.Modal(document.getElementById('authModal')).show();
    } else {
        document.getElementById('chat-toggle-btn')?.click();
    }
});
