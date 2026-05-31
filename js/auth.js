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
    options: { data: { full_name: fullName, role: 'customer' } }
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
  const existing = document.getElementById('accountModal');
  if (existing) existing.remove();

  const avatarUrl = currentProfile?.avatar_url || '';
  const nameParts = (currentProfile?.full_name || '').split(' ');
  const profileNom = nameParts[0] || '';
  const profilePrenom = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  const initial = (profilePrenom || profileNom || '?').charAt(0).toUpperCase();

  const modal = document.createElement('div');
  modal.id = 'accountModal';
  modal.innerHTML = `
    <div class="modal fade" id="accountModalInner" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content" style="border-radius:16px;border:none;">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title fw-bold"><i class="bi bi-person-circle me-2"></i>Mon compte</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="text-center mb-3 position-relative" id="account-avatar-wrap" style="cursor:pointer;">
              <div id="account-avatar-display" style="width:80px;height:80px;border-radius:50%;background:#0d6efd;color:white;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;margin:0 auto;overflow:hidden;position:relative;background-size:cover;background-position:center;${avatarUrl ? `background-image:url('${avatarUrl}');` : ''}">
                ${avatarUrl ? '' : initial}
                <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;" id="account-avatar-overlay">
                  <i class="bi bi-camera-fill text-white" style="font-size:20px;"></i>
                </div>
              </div>
              <input type="file" id="account-avatar-input" accept="image/*" style="display:none;">
              <small class="text-muted d-block mt-1" style="font-size:11px;">Cliquez pour changer l'avatar</small>
            </div>

            <div class="mb-2">
              <small class="text-muted d-block">Email</small>
              <span class="fw-semibold">${currentUser?.email || '—'}</span>
            </div>
            <div class="row g-1 mb-2">
              <div class="col">
                <label class="text-muted d-block" for="account-nom-input">Nom</label>
                <input type="text" id="account-nom-input" class="form-control form-control-sm" value="${profileNom.replace(/"/g, '&quot;')}">
              </div>
              <div class="col">
                <label class="text-muted d-block" for="account-prenom-input">Prénom</label>
                <input type="text" id="account-prenom-input" class="form-control form-control-sm" value="${profilePrenom.replace(/"/g, '&quot;')}">
              </div>
            </div>
            <div class="mb-2">
              <label class="text-muted d-block" for="account-phone-input">Téléphone</label>
              <input type="tel" id="account-phone-input" class="form-control form-control-sm" value="${(currentProfile?.phone || '').replace(/"/g, '&quot;')}" placeholder="+242 XX XXX XX XX">
            </div>
            <div class="mb-2">
              <small class="text-muted d-block">Rôle</small>
              <span class="badge bg-${currentProfile?.role === 'super_admin' ? 'danger' : currentProfile?.role === 'admin' ? 'warning text-dark' : 'secondary'}">${currentProfile?.role === 'super_admin' ? 'Super Admin' : currentProfile?.role === 'admin' ? 'Administrateur' : 'Client'}</span>
            </div>
            <div id="account-upload-progress" class="d-none mt-2">
              <div class="progress" style="height:6px;">
                <div id="account-upload-bar" class="progress-bar progress-bar-striped progress-bar-animated" style="width:0%"></div>
              </div>
              <small id="account-upload-status" class="text-muted d-block mt-1"></small>
            </div>
            <div id="account-error" class="alert alert-danger d-none py-2 small mt-2"></div>
          </div>
          <div class="modal-footer border-0 pt-0 flex-wrap gap-2">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Fermer</button>
            <button type="button" class="btn btn-outline-primary btn-sm" id="account-change-pwd-btn"><i class="bi bi-key me-1"></i>Mot de passe</button>
            <button type="button" class="btn btn-primary" id="account-save-btn"><i class="bi bi-check2 me-1"></i>Enregistrer</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const avatarWrap = document.getElementById('account-avatar-wrap');
  const avatarInput = document.getElementById('account-avatar-input');
  const avatarDisplay = document.getElementById('account-avatar-display');
  const avatarOverlay = document.getElementById('account-avatar-overlay');
  let pendingAvatarBlob = null;

  avatarWrap.addEventListener('mouseenter', () => { avatarOverlay.style.opacity = '1'; });
  avatarWrap.addEventListener('mouseleave', () => { avatarOverlay.style.opacity = '0'; });
  avatarWrap.addEventListener('click', () => avatarInput.click());

  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showAccountError('Image trop lourde (max 5 Mo).');
      avatarInput.value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      showAccountError('Veuillez sélectionner une image.');
      avatarInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 200;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        canvas.toBlob((blob) => {
          if (!blob) return;
          pendingAvatarBlob = blob;
          const url = URL.createObjectURL(blob);
          avatarDisplay.style.backgroundImage = `url('${url}')`;
          avatarDisplay.style.backgroundSize = 'cover';
          avatarDisplay.style.backgroundPosition = 'center';
          avatarDisplay.textContent = '';
        }, 'image/webp', 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('account-save-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('account-error');
    errEl.classList.add('d-none');
    const saveBtn = document.getElementById('account-save-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enregistrement...';

    try {
      let newAvatarUrl = currentProfile?.avatar_url || '';

      if (pendingAvatarBlob) {
        const progressEl = document.getElementById('account-upload-progress');
        const barEl = document.getElementById('account-upload-bar');
        const statusEl = document.getElementById('account-upload-status');
        progressEl.classList.remove('d-none');
        barEl.style.width = '0%';
        statusEl.textContent = 'Upload en cours...';

        const fileName = `avatars/${currentUser.id}_${Date.now()}.webp`;
        const { error: uploadErr } = await supabase.storage.from('avatars').upload(fileName, pendingAvatarBlob, {
          upsert: true,
          contentType: 'image/webp'
        });
        if (uploadErr) throw uploadErr;
        barEl.style.width = '100%';
        statusEl.textContent = 'Image uploadée.';
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
        newAvatarUrl = urlData.publicUrl;
      }

      const newNom = document.getElementById('account-nom-input').value.trim();
      const newPrenom = document.getElementById('account-prenom-input').value.trim();
      const newName = `${newNom} ${newPrenom}`.trim();
      const newPhone = document.getElementById('account-phone-input').value.trim();
      if (newName || pendingAvatarBlob || newPhone !== (currentProfile?.phone || '')) {
        const updates = {};
        if (newName) updates.full_name = newName;
        if (newAvatarUrl) updates.avatar_url = newAvatarUrl;
        if (newPhone !== (currentProfile?.phone || '')) updates.phone = newPhone || null;

        const { error: updateErr } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);
        if (updateErr) throw updateErr;

        if (currentProfile) {
          if (newName) currentProfile.full_name = newName;
          if (newAvatarUrl) currentProfile.avatar_url = newAvatarUrl;
          currentProfile.phone = newPhone || null;
        }
      }

      const m = bootstrap.Modal.getInstance(document.getElementById('accountModalInner'));
      if (m) m.hide();
      showToast('Profil mis à jour avec succès.', 'success');
      notifyListeners();
    } catch (err) {
      errEl.textContent = 'Erreur : ' + err.message;
      errEl.classList.remove('d-none');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>Enregistrer';
    }
  });

  document.getElementById('account-change-pwd-btn').addEventListener('click', () => {
    const m = bootstrap.Modal.getInstance(document.getElementById('accountModalInner'));
    if (m) m.hide();
    modal.addEventListener('hidden.bs.modal', () => {
      showPasswordChangeForm();
    }, { once: true });
  });

  const m = new bootstrap.Modal(document.getElementById('accountModalInner'));
  m.show();
  document.getElementById('accountModalInner')?.addEventListener('hidden.bs.modal', () => modal.remove());
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

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: current
    });
    if (signInErr) { errEl.textContent = 'Mot de passe actuel incorrect.'; errEl.classList.remove('d-none'); return; }

    const { error: updateErr } = await supabase.auth.updateUser({ password: pwd });
    if (updateErr) { errEl.textContent = updateErr.message; errEl.classList.remove('d-none'); return; }

    bootstrap.Modal.getInstance(document.getElementById('pwdChangeModalInner')).hide();
    showToast('Mot de passe mis à jour avec succès.', 'success');
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
                  <input type="password" id="signup-password" class="form-control" placeholder="Mot de passe (6+ caractères)" autocomplete="new-password">
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
    if (password.length < 6) { errEl.textContent = 'Le mot de passe doit faire au moins 6 caractères.'; errEl.classList.remove('d-none'); return; }
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
        <div class="toast-body">${message}</div>
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
        el.innerHTML = `<a href="compte.html" class="btn btn-outline-secondary d-flex align-items-center justify-content-center" style="width:38px;height:38px;" title="Mon compte">
          <i class="bi bi-person-circle"></i>
        </a>`;
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
