import { initAuth, buildAuthModal, updateNavAuthUI, onAuthChange, getUser, getProfile, signOut, showToast, getSupabase } from './auth.js';

let supabase;
let currentUser = null;
let currentProfile = null;
let pendingAvatarBlob = null;

async function loadAccount() {
  supabase = getSupabase();
  currentUser = getUser();
  currentProfile = getProfile();

  if (!currentUser) {
    document.getElementById('account-loading').style.display = 'none';
    document.getElementById('account-login-required').style.display = 'block';
    return;
  }

  document.getElementById('account-loading').style.display = 'none';
  document.getElementById('account-content').style.display = 'block';

  populateProfile();
  bindEvents();
}

function populateProfile() {
  const p = currentProfile;
  const u = currentUser;

  const parts = (p?.full_name || '').split(' ');
  const prenom = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const nom = parts[0] || '';

  document.getElementById('account-subtitle').textContent = prenom
    ? `Bienvenue, ${prenom}`
    : 'Gérez vos informations personnelles';

  document.getElementById('account-display-name').textContent = p?.full_name || u?.email || 'Utilisateur';

  const role = p?.role || 'customer';
  const roleBadge = document.getElementById('account-display-role');
  const roleMap = {
    admin: { label: 'Administrateur', class: 'bg-warning text-dark' },
    super_admin: { label: 'Super Admin', class: 'bg-danger' },
    customer: { label: 'Client', class: 'bg-secondary' }
  };
  const r = roleMap[role] || roleMap.customer;
  roleBadge.textContent = r.label;
  roleBadge.className = `badge ${r.class}`;

  const initial = p?.full_name?.charAt(0).toUpperCase() || u?.email?.charAt(0).toUpperCase() || '?';
  const initialEl = document.getElementById('account-avatar-initial');
  const displayEl = document.getElementById('account-avatar-display');

  if (p?.avatar_url) {
    initialEl.style.display = 'none';
    displayEl.style.backgroundImage = `url('${p.avatar_url}')`;
    displayEl.style.backgroundSize = 'cover';
    displayEl.style.backgroundPosition = 'center';
  } else {
    initialEl.style.display = 'flex';
    initialEl.textContent = initial;
    displayEl.style.backgroundImage = '';
  }

  document.getElementById('account-email-input').value = u?.email || '';

  if (document.getElementById('account-nom-input').value === '') {
    document.getElementById('account-nom-input').value = nom;
  }
  if (document.getElementById('account-prenom-input').value === '') {
    document.getElementById('account-prenom-input').value = prenom;
  }
  if (document.getElementById('account-phone-input').value === '') {
    document.getElementById('account-phone-input').value = p?.phone || '';
  }

  if (p?.created_at) {
    const d = new Date(p.created_at);
    document.getElementById('account-member-since').textContent =
      d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' });
  }
}

function bindEvents() {
  const avatarWrap = document.getElementById('account-avatar-wrap');
  const avatarInput = document.getElementById('account-avatar-input');
  const avatarDisplay = document.getElementById('account-avatar-display');
  const avatarOverlay = document.getElementById('account-avatar-overlay');

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
          document.getElementById('account-avatar-initial').style.display = 'none';
        }, 'image/webp', 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('account-save-btn').addEventListener('click', saveProfile);

  document.getElementById('pwd-save-btn').addEventListener('click', changePassword);

  document.getElementById('account-logout-btn').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'index.html';
  });

  ['account-nom-input', 'account-prenom-input', 'account-phone-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveProfile();
    });
  });

  ['pwd-current-input', 'pwd-new-input', 'pwd-confirm-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') changePassword();
    });
  });

  const deleteInput = document.getElementById('delete-confirm-input');
  const deleteBtn = document.getElementById('delete-account-btn');
  deleteInput.addEventListener('input', () => {
    deleteBtn.disabled = deleteInput.value.trim() !== 'SUPPRIMER';
  });
  deleteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !deleteBtn.disabled) deleteAccount();
  });
  deleteBtn.addEventListener('click', deleteAccount);
}

async function saveProfile() {
  const errEl = document.getElementById('account-error');
  errEl.classList.add('d-none');
  const btn = document.getElementById('account-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enregistrement...';

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

    if (newName !== currentProfile?.full_name || newAvatarUrl !== currentProfile?.avatar_url || newPhone !== (currentProfile?.phone || '')) {
      const updates = {};
      if (newName !== currentProfile?.full_name) updates.full_name = newName || null;
      if (newAvatarUrl !== currentProfile?.avatar_url) updates.avatar_url = newAvatarUrl;
      if (newPhone !== (currentProfile?.phone || '')) updates.phone = newPhone || null;

      const { error: updateErr } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);
      if (updateErr) throw updateErr;

      if (currentProfile) {
        if (updates.full_name !== undefined) currentProfile.full_name = updates.full_name;
        if (updates.avatar_url !== undefined) currentProfile.avatar_url = updates.avatar_url;
        if (updates.phone !== undefined) currentProfile.phone = updates.phone;
      }
    }

    showToast('Profil mis à jour avec succès.', 'success');
  } catch (err) {
    errEl.textContent = 'Erreur : ' + err.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i> Enregistrer';
  }
}

async function changePassword() {
  const current = document.getElementById('pwd-current-input').value;
  const pwd = document.getElementById('pwd-new-input').value;
  const confirm = document.getElementById('pwd-confirm-input').value;
  const errEl = document.getElementById('pwd-error');
  errEl.classList.add('d-none');

  if (!current || !pwd || !confirm) {
    errEl.textContent = 'Veuillez remplir tous les champs.';
    errEl.classList.remove('d-none');
    return;
  }
  if (pwd.length < 6) {
    errEl.textContent = 'Le nouveau mot de passe doit faire au moins 6 caractères.';
    errEl.classList.remove('d-none');
    return;
  }
  if (pwd !== confirm) {
    errEl.textContent = 'Les mots de passe ne correspondent pas.';
    errEl.classList.remove('d-none');
    return;
  }

  const btn = document.getElementById('pwd-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Mise à jour...';

  try {
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: current
    });
    if (signInErr) throw new Error('Mot de passe actuel incorrect.');

    const { error: updateErr } = await supabase.auth.updateUser({ password: pwd });
    if (updateErr) throw updateErr;

    document.getElementById('pwd-current-input').value = '';
    document.getElementById('pwd-new-input').value = '';
    document.getElementById('pwd-confirm-input').value = '';
    const collapse = bootstrap.Collapse.getInstance(document.getElementById('pwd-section'));
    if (collapse) collapse.hide();

    showToast('Mot de passe mis à jour avec succès.', 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i> Mettre à jour le mot de passe';
  }
}

async function deleteAccount() {
  const errEl = document.getElementById('delete-error');
  errEl.classList.add('d-none');
  const btn = document.getElementById('delete-account-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Suppression...';

  try {
    const { error } = await supabase.rpc('delete_my_account');
    if (error) throw error;

    await signOut();
    window.location.href = 'index.html?deleted=1';
  } catch (err) {
    errEl.textContent = 'Erreur : ' + err.message;
    errEl.classList.remove('d-none');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-trash me-1"></i> Supprimer mon compte';
    document.getElementById('delete-confirm-input').value = '';
  }
}

function showAccountError(msg) {
  const el = document.getElementById('account-error');
  if (el) { el.textContent = msg; el.classList.remove('d-none'); }
}

document.addEventListener('DOMContentLoaded', async () => {
  buildAuthModal();
  await initAuth();
  loadAccount();
  updateNavAuthUI();

  onAuthChange((user, profile) => {
    currentUser = user;
    currentProfile = profile;
    if (user && profile) {
      const loginEl = document.getElementById('account-login-required');
      const contentEl = document.getElementById('account-content');
      if (loginEl) loginEl.style.display = 'none';
      if (contentEl) {
        contentEl.style.display = 'block';
        populateProfile();
      }
    } else {
      const loadingEl = document.getElementById('account-loading');
      const contentEl = document.getElementById('account-content');
      const loginEl = document.getElementById('account-login-required');
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'none';
      if (loginEl) loginEl.style.display = 'block';
    }
    updateNavAuthUI();
  });
});
