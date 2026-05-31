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

    document.querySelectorAll('.auth-placeholder-mobile').forEach(el => {
        onAuthChange((user, profile) => {
            if (user && profile) {
                el.innerHTML = `
                    <div class="text-white px-2 mb-2">
                        <div class="d-flex align-items-center justify-content-between mb-2">
                            <span><i class="bi bi-person-circle me-1"></i> ${profile.full_name || profile.email}</span>
                            <button class="btn btn-sm btn-outline-light" id="mobile-logout-btn"><i class="bi bi-box-arrow-right"></i></button>
                        </div>
                        <a href="compte.html" class="btn btn-outline-light btn-sm w-100"><i class="bi bi-person me-1"></i> Mon compte</a>
                    </div>`;
                el.querySelector('#mobile-logout-btn')?.addEventListener('click', async () => {
                    try {
                        const { signOut } = await import('./auth.js');
                        await signOut();
                    } catch (err) {
                        console.error('Mobile logout error:', err);
                    }
                });
            } else {
                el.innerHTML = `<button class="btn btn-outline-light w-100 mb-2" data-bs-toggle="modal" data-bs-target="#authModal">
                    <i class="bi bi-person me-1"></i> Connexion
                </button>`;
            }
        });
    });
}
