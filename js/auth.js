import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

function getTabId() {
  let id = sessionStorage.getItem('trusttec_tab_id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('trusttec_tab_id', id);
  }
  return id;
}

function clearSupabaseStorage() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb-')) {
      localStorage.removeItem(key);
    }
  }
}

const tabStorage = {
  getItem(key) {
    const prefixed = `${key}_${getTabId()}`;
    const val = localStorage.getItem(prefixed);
    if (val !== null) return val;
    const unprefixed = localStorage.getItem(key);
    if (unprefixed !== null) localStorage.setItem(prefixed, unprefixed);
    return unprefixed;
  },
  setItem(key, value) {
    localStorage.setItem(`${key}_${getTabId()}`, value);
    localStorage.setItem(key, value);
  },
  removeItem(key) {
    localStorage.removeItem(`${key}_${getTabId()}`);
    localStorage.removeItem(key);
  }
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: tabStorage
  }
});

let currentUser = null;
let currentProfile = null;
let authListeners = [];

export function onAuthChange(callback) {
  authListeners.push(callback);
  if (currentUser) callback(currentUser, currentProfile);
  return () => { authListeners = authListeners.filter(l => l !== callback); };
}

function notifyListeners() {
  authListeners.forEach(fn => fn(currentUser, currentProfile));
}

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    currentUser = session.user;
    await loadProfile();
  } else {
    clearSupabaseStorage();
  }

  notifyListeners();

  let authGuard = false;

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (authGuard) return;
    authGuard = true;
    try {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        currentUser = session.user;
        await loadProfile();

        if (event === 'SIGNED_IN') {
          try {
            await supabase
              .from('profiles')
              .update({ last_login_at: new Date().toISOString() })
              .eq('id', session.user.id);
          } catch (_) {}
        }

        const lastUpdate = localStorage.getItem('trusttec_last_seen');
        const oneHourAgo = Date.now() - 3600 * 1000;
        if (!lastUpdate || parseInt(lastUpdate) < oneHourAgo) {
          try {
            await supabase
              .from('profiles')
              .update({ last_seen_at: new Date().toISOString() })
              .eq('id', session.user.id);
            localStorage.setItem('trusttec_last_seen', Date.now().toString());
          } catch (_) {}
        }
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentProfile = null;
        clearSupabaseStorage();
      }
      notifyListeners();
    } finally {
      setTimeout(() => { authGuard = false; }, 1000);
    }
  });

  if (window.location.hash?.includes('type=recovery')) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      currentUser = user;
      await loadProfile();
      notifyListeners();
      showPasswordResetForm();
    }
  }
}

export function showPasswordResetForm() {
  const existing = document.getElementById('passwordResetModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'passwordResetModal';
  modal.innerHTML = `
    <div class="modal fade" id="passwordResetModalInner" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content" style="border-radius:16px;border:none;">
          <div class="modal-header border-0">
            <h5 class="modal-title fw-bold"><i class="bi bi-key me-2"></i>Nouveau mot de passe</h5>
          </div>
          <div class="modal-body">
            <div id="reset-pwd-error" class="alert alert-danger d-none py-2 small"></div>
            <div class="mb-3">
              <input type="password" id="new-password-input" class="form-control" placeholder="Nouveau mot de passe (6+ caractères)" autocomplete="new-password">
            </div>
            <div class="mb-3">
              <input type="password" id="confirm-password-input" class="form-control" placeholder="Confirmer le mot de passe" autocomplete="new-password">
            </div>
            <button id="update-password-btn" class="btn btn-primary w-100 fw-bold">
              <i class="bi bi-check2 me-1"></i> Mettre à jour
            </button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('update-password-btn').addEventListener('click', async () => {
    const pwd = document.getElementById('new-password-input').value;
    const confirm = document.getElementById('confirm-password-input').value;
    const errEl = document.getElementById('reset-pwd-error');
    errEl.classList.add('d-none');
    if (!pwd || pwd.length < 6) { errEl.textContent = 'Le mot de passe doit faire au moins 6 caractères.'; errEl.classList.remove('d-none'); return; }
    if (pwd !== confirm) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.remove('d-none'); return; }
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) { errEl.textContent = error.message; errEl.classList.remove('d-none'); return; }
    bootstrap.Modal.getInstance(document.getElementById('passwordResetModalInner')).hide();
    showToast('Mot de passe mis à jour avec succès.', 'success');
  });

  ['new-password-input', 'confirm-password-input'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('update-password-btn').click(); })
  );

  const m = new bootstrap.Modal(document.getElementById('passwordResetModalInner'));
  m.show();
  document.getElementById('passwordResetModalInner')?.addEventListener('hidden.bs.modal', () => modal.remove());
}

async function loadProfile() {
  if (!currentUser) { currentProfile = null; return; }
  const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = data || null;
  if (!data) {
    await supabase.from('profiles').insert({
      id: currentUser.id,
      email: currentUser.email,
      full_name: currentUser.user_metadata?.full_name || '',
      role: 'customer'
    });
    const { data: retry } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
    currentProfile = retry || null;
  }
}

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role: 'customer' },
      emailRedirectTo: window.location.origin
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function getUser() { return currentUser; }
export function getProfile() { return currentProfile; }
export function getSupabase() { return supabase; }
export function isAdmin() { return currentProfile?.role === 'admin' || currentProfile?.role === 'super_admin'; }
export function isSuperAdmin() { return currentProfile?.role === 'super_admin'; }

export function openMyAccount() {
  window.location.href = 'compte.html';
}

function showPasswordChangeForm() {
  const existing = document.getElementById('pwdChangeModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'pwdChangeModal';
  modal.innerHTML = `
    <div class="modal fade" id="pwdChangeModalInner" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content" style="border-radius:16px;border:none;">
          <div class="modal-header border-0">
            <h5 class="modal-title fw-bold"><i class="bi bi-key me-2"></i>Changer le mot de passe</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div id="pwd-change-error" class="alert alert-danger d-none py-2 small"></div>
            <div class="mb-3">
              <input type="password" id="pwd-current-input" class="form-control" placeholder="Mot de passe actuel" autocomplete="current-password">
            </div>
            <div class="mb-3">
              <input type="password" id="pwd-new-input" class="form-control" placeholder="Nouveau mot de passe (6+ caractères)" autocomplete="new-password">
            </div>
            <div class="mb-3">
              <input type="password" id="pwd-confirm-input" class="form-control" placeholder="Confirmer le nouveau mot de passe" autocomplete="new-password">
            </div>
          </div>
          <div class="modal-footer border-0 pt-0 justify-content-between">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annuler</button>
            <button type="button" class="btn btn-primary" id="pwd-change-save-btn"><i class="bi bi-check2 me-1"></i>Mettre à jour</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('pwd-change-save-btn').addEventListener('click', async () => {
    const current = document.getElementById('pwd-current-input').value;
    const pwd = document.getElementById('pwd-new-input').value;
    const confirm = document.getElementById('pwd-confirm-input').value;
    const errEl = document.getElementById('pwd-change-error');
    errEl.classList.add('d-none');
    if (!current || !pwd || !confirm) { errEl.textContent = 'Veuillez remplir tous les champs.'; errEl.classList.remove('d-none'); return; }
    if (pwd.length < 6) { errEl.textContent = 'Le nouveau mot de passe doit faire au moins 6 caractères.'; errEl.classList.remove('d-none'); return; }
    if (pwd !== confirm) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.remove('d-none'); return; }

    try {
      await updatePassword(current, pwd);
      bootstrap.Modal.getInstance(document.getElementById('pwdChangeModalInner')).hide();
      showToast('Mot de passe mis à jour avec succès.', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    }
  });

  ['pwd-current-input', 'pwd-new-input', 'pwd-confirm-input'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pwd-change-save-btn').click(); })
  );

  const m = new bootstrap.Modal(document.getElementById('pwdChangeModalInner'));
  m.show();
  document.getElementById('pwdChangeModalInner')?.addEventListener('hidden.bs.modal', () => modal.remove());
}

function showAccountError(msg) {
  const el = document.getElementById('account-error');
  if (el) { el.textContent = msg; el.classList.remove('d-none'); }
}

export async function updatePassword(currentPassword, newPassword) {
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: currentUser.email,
    password: currentPassword
  });
  if (signInErr) throw new Error('Mot de passe actuel incorrect.');

  const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updateErr) throw updateErr;
}

export async function uploadAvatar(blob, userId) {
  const fileName = `avatars/${userId}_${Date.now()}.webp`;
  const { error: uploadErr } = await supabase.storage.from('avatars').upload(fileName, blob, {
    upsert: true,
    contentType: 'image/webp'
  });
  if (uploadErr) throw uploadErr;
  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
  return urlData.publicUrl;
}

export function buildAuthModal() {
  if (document.getElementById('trusttec-auth-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'trusttec-auth-modal';
  modal.innerHTML = `
    <div class="modal fade" id="authModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content" style="border-radius:16px;border:none;">
          <div class="modal-header border-0 pb-0">
            <ul class="nav nav-pills w-100 justify-content-center" id="authTabs" role="tablist">
              <li class="nav-item" role="presentation">
                <button class="nav-link active" id="login-tab" data-bs-toggle="pill" data-bs-target="#login-panel" type="button" role="tab">Connexion</button>
              </li>
              <li class="nav-item" role="presentation">
                <button class="nav-link" id="signup-tab" data-bs-toggle="pill" data-bs-target="#signup-panel" type="button" role="tab">Inscription</button>
              </li>
            </ul>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="tab-content" id="authTabContent">
              <div class="tab-pane fade show active" id="login-panel" role="tabpanel">
                <div id="login-error" class="alert alert-danger d-none py-2 small"></div>
                <div class="mb-3">
                  <input type="email" id="login-email" class="form-control" placeholder="Votre email" autocomplete="email">
                </div>
                <div class="mb-3">
                  <input type="password" id="login-password" class="form-control" placeholder="Mot de passe" autocomplete="current-password">
                </div>
                <div class="text-end mb-3">
                  <a href="#" id="forgot-password-link" class="small text-decoration-none">Mot de passe oublié ?</a>
                </div>
                <button id="login-btn" class="btn btn-primary w-100 fw-bold">
                  <i class="bi bi-box-arrow-in-right me-1"></i> Se connecter
                </button>
              </div>
              <div class="tab-pane fade" id="signup-panel" role="tabpanel">
                <div id="signup-error" class="alert alert-danger d-none py-2 small"></div>
                <div class="mb-3">
                  <input type="text" id="signup-nom" class="form-control" placeholder="Nom" autocomplete="family-name">
                </div>
                <div class="mb-3">
                  <input type="text" id="signup-prenom" class="form-control" placeholder="Prénom" autocomplete="given-name">
                </div>
                <div class="mb-3">
                  <input type="email" id="signup-email" class="form-control" placeholder="Votre email" autocomplete="email">
                </div>
                <div class="mb-3">
                  <input type="password" id="signup-password" class="form-control" placeholder="Mot de passe (8+ caractères)" autocomplete="new-password">
                  <div class="mt-2" id="password-strength" style="display:none;">
                    <div class="d-flex align-items-center gap-2">
                      <div class="flex-grow-1" style="height:6px;background:#e9ecef;border-radius:3px;overflow:hidden;">
                        <div id="strength-bar" style="height:100%;width:0;border-radius:3px;transition:width .3s,background .3s;"></div>
                      </div>
                      <small id="strength-label" class="text-muted" style="min-width:90px;text-align:right;"></small>
                    </div>
                  </div>
                </div>
                <button id="signup-btn" class="btn btn-success w-100 fw-bold">
                  <i class="bi bi-person-plus me-1"></i> Créer mon compte
                </button>
                <p class="text-muted small text-center mt-2 mb-0">
                  <i class="bi bi-info-circle"></i> Un email de confirmation vous sera envoyé
                </p>
              </div>
              <div class="tab-pane fade" id="reset-panel" role="tabpanel">
                <div id="reset-error" class="alert alert-danger d-none py-2 small"></div>
                <div id="reset-success" class="alert alert-success d-none py-2 small"></div>
                <p class="text-muted small">Entrez votre email pour recevoir un lien de réinitialisation.</p>
                <div class="mb-3">
                  <input type="email" id="reset-email" class="form-control" placeholder="Votre email" autocomplete="email">
                </div>
                <button id="reset-btn" class="btn btn-primary w-100 fw-bold">
                  <i class="bi bi-send me-1"></i> Envoyer
                </button>
                <div class="text-center mt-2">
                  <a href="#" id="reset-back-link" class="small text-decoration-none">← Retour à la connexion</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-tab').classList.remove('active');
    document.getElementById('login-panel').classList.remove('show', 'active');
    document.getElementById('reset-panel').classList.add('show', 'active');
  });

  document.getElementById('reset-back-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('reset-panel').classList.remove('show', 'active');
    document.getElementById('login-tab').classList.add('active');
    document.getElementById('login-panel').classList.add('show', 'active');
  });

  document.getElementById('reset-btn').addEventListener('click', async () => {
    const email = document.getElementById('reset-email').value.trim();
    const errEl = document.getElementById('reset-error');
    const successEl = document.getElementById('reset-success');
    errEl.classList.add('d-none');
    successEl.classList.add('d-none');
    if (!email) { errEl.textContent = 'Veuillez entrer votre email.'; errEl.classList.remove('d-none'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if (error) { errEl.textContent = error.message; errEl.classList.remove('d-none'); return; }
    successEl.textContent = 'Email envoyé ! Vérifiez votre boîte de réception.';
    successEl.classList.remove('d-none');
  });

  document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('d-none');
    if (!email || !password) { errEl.textContent = 'Veuillez remplir tous les champs.'; errEl.classList.remove('d-none'); return; }
    try {
      await signIn(email, password);
      const modalEl = bootstrap.Modal.getInstance(document.getElementById('authModal'));
      if (modalEl) modalEl.hide();
    } catch (e) { errEl.textContent = e.message; errEl.classList.remove('d-none'); }
  });

  document.getElementById('signup-btn').addEventListener('click', async () => {
    const nom = document.getElementById('signup-nom').value.trim();
    const prenom = document.getElementById('signup-prenom').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errEl = document.getElementById('signup-error');
    errEl.classList.add('d-none');
    if (!nom || !prenom || !email || !password) { errEl.textContent = 'Veuillez remplir tous les champs.'; errEl.classList.remove('d-none'); return; }
    const name = `${nom} ${prenom}`.trim();
    if (password.length < 8) { errEl.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; errEl.classList.remove('d-none'); return; }
    try {
      await signUp(email, password, name);
      const modalEl = bootstrap.Modal.getInstance(document.getElementById('authModal'));
      if (modalEl) modalEl.hide();
      showToast('Inscription réussie ! Vérifiez votre email pour confirmer.', 'success');
    } catch (e) { errEl.textContent = e.message; errEl.classList.remove('d-none'); }
  });

  ['login-email', 'login-password'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-btn').click(); })
  );
  ['signup-nom', 'signup-prenom', 'signup-email', 'signup-password'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('signup-btn').click(); })
  );
  document.getElementById('reset-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('reset-btn').click(); });

  const pwdInput = document.getElementById('signup-password');
  const strengthDiv = document.getElementById('password-strength');
  const bar = document.getElementById('strength-bar');
  const label = document.getElementById('strength-label');

  document.getElementById('authModal').addEventListener('hidden.bs.modal', () => {
    pwdInput.value = '';
    strengthDiv.style.display = 'none';
    bar.style.width = '0';
  });

  pwdInput.addEventListener('input', () => {
    const val = pwdInput.value;
    if (!val) { strengthDiv.style.display = 'none'; return; }
    strengthDiv.style.display = '';

    let score = 0;
    if (val.length >= 8) score++;
    if (val.length >= 12) score++;
    if (/[a-z]/.test(val)) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/\d/.test(val)) score++;
    if (/[^a-zA-Z0-9]/.test(val)) score++;

    const levels = [
      { max: 1, pct: 20, color: '#dc3545', text: 'Très mauvais' },
      { max: 2, pct: 40, color: '#e67e22', text: 'Mauvais' },
      { max: 3, pct: 60, color: '#f39c12', text: 'Moyen' },
      { max: 4, pct: 80, color: '#8bc34a', text: 'Bon' },
      { max: 6, pct: 100, color: '#28a745', text: 'Très bon' }
    ];
    const current = levels.find(l => score <= l.max) || levels[levels.length - 1];
    bar.style.width = current.pct + '%';
    bar.style.background = current.color;
    label.textContent = current.text;
    label.style.color = current.color;
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || (() => {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    c.style.zIndex = '9999';
    document.body.appendChild(c);
    return c;
  })();

  const id = `toast-${Date.now()}`;
  const bgMap = { success: 'text-bg-success', error: 'text-bg-danger', warning: 'text-bg-warning', info: 'text-bg-info' };
  const bg = bgMap[type] || 'text-bg-info';

  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast ${bg} border-0" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="3000">
      <div class="d-flex">
        <div class="toast-body">${escHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);

  const el = document.getElementById(id);
  if (el) { new bootstrap.Toast(el).show(); el.addEventListener('hidden.bs.toast', () => el.remove()); }
}

export function updateNavAuthUI() {
  try {
    const user = getUser();
    const profile = getProfile();
    document.querySelectorAll('.auth-placeholder').forEach(el => {
      if (user) {
        const name = profile?.full_name || user.email || 'Compte';
        el.innerHTML = `
          <div class="dropdown">
            <button class="btn btn-outline-secondary dropdown-toggle d-flex align-items-center gap-2" data-bs-toggle="dropdown">
              <i class="bi bi-person-circle"></i>
              <span class="d-none d-md-inline">${name}</span>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#" id="nav-my-account"><i class="bi bi-person me-2"></i>Mon compte</a></li>
              ${profile?.role === 'admin' || profile?.role === 'super_admin' ? `
              <li><a class="dropdown-item" href="Admin.html" id="nav-admin"><i class="bi bi-shield-lock me-2"></i>Administration</a></li>
              ` : ''}
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item text-danger" href="#" id="nav-logout"><i class="bi bi-box-arrow-right me-2"></i>Déconnexion</a></li>
            </ul>
          </div>`;
        el.querySelector('#nav-logout')?.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            await signOut();
          } catch (err) {
            console.error('Logout error:', err);
          }
          updateNavAuthUI();
        });
        el.querySelector('#nav-my-account')?.addEventListener('click', (e) => {
          e.preventDefault();
          window.location.href = 'compte.html';
        });
      } else {
        el.innerHTML = `<button class="btn btn-outline-primary" data-bs-toggle="modal" data-bs-target="#authModal">
          <i class="bi bi-person me-1"></i> Connexion
        </button>`;
      }
    });
    document.querySelectorAll('.mobile-auth-btn-placeholder').forEach(el => {
      if (user) {
        const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
        if (isAdmin) {
          el.innerHTML = `<div class="dropdown">
            <button class="btn btn-outline-secondary d-flex align-items-center justify-content-center dropdown-toggle" style="width:38px;height:38px;" data-bs-toggle="dropdown" title="Mon compte" aria-label="Mon compte">
              <i class="bi bi-person-circle"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="compte.html"><i class="bi bi-person me-2"></i>Mon compte</a></li>
              <li><a class="dropdown-item" href="Admin.html"><i class="bi bi-shield-lock me-2"></i>Administration</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item text-danger" href="#" id="mobile-nav-logout"><i class="bi bi-box-arrow-right me-2"></i>Déconnexion</a></li>
            </ul>
          </div>`;
          el.querySelector('#mobile-nav-logout')?.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
              await signOut();
            } catch (err) {
              console.error('Logout error:', err);
            }
            updateNavAuthUI();
          });
        } else {
          el.innerHTML = `<a href="compte.html" class="btn btn-outline-secondary d-flex align-items-center justify-content-center" style="width:38px;height:38px;" title="Mon compte">
            <i class="bi bi-person-circle"></i>
          </a>`;
        }
      } else {
        el.innerHTML = `<button class="btn btn-outline-primary d-flex align-items-center justify-content-center" style="width:38px;height:38px;" data-bs-toggle="modal" data-bs-target="#authModal" title="Connexion / Inscription">
          <i class="bi bi-person"></i>
        </button>`;
      }
    });
  } catch (err) {
    console.error('updateNavAuthUI error:', err);
  }
}
