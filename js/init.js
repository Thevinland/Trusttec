import { initAuth, buildAuthModal, updateNavAuthUI, onAuthChange } from './auth.js';
import { initChat } from './chat.js';

export async function initApp() {
    buildAuthModal();
    await initAuth();
    initChat();
    updateNavAuthUI();
    onAuthChange(() => updateNavAuthUI());

    document.getElementById('chat-order-btn')?.addEventListener('click', async () => {
        const { getUser } = await import('./auth.js');
        const user = getUser();
        if (!user) {
            new bootstrap.Modal(document.getElementById('authModal')).show();
        } else {
            bootstrap.Modal.getInstance(document.getElementById('cartModal'))?.hide();
            document.getElementById('chat-toggle-btn')?.click();
        }
    });


}
