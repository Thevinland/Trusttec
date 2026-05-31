import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const STORAGE_BUCKET = 'images';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
    }
});

let categories = [];
let allProducts = [];
let editingId = null;
let editingCatId = null;
let deletingId = null;
let deletingType = null;
let uploadedImageUrl = null;
let colorUploadTargetRow = null;
let currentAdminRole = null;

let cropperInstance = null;
let pendingFile = null;
let currentFlipH = 1;
let currentFlipV = 1;

let chartRegistrations = null;
let chartCategories    = null;
let chartMessages      = null;

const productModal = new bootstrap.Modal(document.getElementById('productModal'));
const categoryModal = new bootstrap.Modal(document.getElementById('categoryModal'));
const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
const cropperModal = new bootstrap.Modal(document.getElementById('cropperModal'));
const deleteConvModal = new bootstrap.Modal(document.getElementById('deleteConvModal'));

function openDrawer() {
    document.getElementById('mobile-drawer').classList.add('open');
    document.getElementById('mobile-drawer-overlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
}
window.closeDrawer = function () {
    document.getElementById('mobile-drawer').classList.remove('open');
    document.getElementById('mobile-drawer-overlay').style.display = 'none';
    document.body.style.overflow = '';
};
document.getElementById('mobile-menu-btn').addEventListener('click', openDrawer);
document.getElementById('drawer-close-btn').addEventListener('click', closeDrawer);
document.getElementById('mobile-drawer-overlay').addEventListener('click', closeDrawer);
document.getElementById('drawer-logout-btn').addEventListener('click', async () => {
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch (_) {}
    Object.keys(localStorage).filter(k => k.includes('supabase')).forEach(k => localStorage.removeItem(k));
    closeDrawer();
    document.getElementById('admin-screen').classList.add('d-none');
    document.getElementById('login-screen').style.display = 'flex';
});

document.getElementById('cat-field-label').addEventListener('input', function () {
    if (editingCatId) return;
    const generated = this.value
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    document.getElementById('cat-field-id').value = generated;
    document.getElementById('cat-id-preview').textContent = generated ? `→ ID : ${generated}` : '';
});

window.showPage = function (page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link-item').forEach(a => a.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    const navLink = document.getElementById('nav-' + page);
    if (navLink) navLink.classList.add('active');
    const drawerLink = document.getElementById('drawer-nav-' + page);
    if (drawerLink) drawerLink.classList.add('active');
    if (page === 'categories') loadCategoriesTable();
    if (page === 'chat') loadAdminChats();
    if (page === 'admins') loadAdmins();
    if (page === 'logs') loadLogs();
    if (page === 'stats') loadStats();
};

document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('d-none');
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { errEl.textContent = 'Identifiants incorrects : ' + error.message; errEl.classList.remove('d-none'); return; }
    if (authData?.user) {
      await supabase
        .from('profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', authData.user.id)
        .maybeSingle();
    }
    showAdmin(email);
});
['login-email', 'login-password'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-btn').click(); })
);
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch (_) {}
    Object.keys(localStorage).filter(k => k.includes('supabase')).forEach(k => localStorage.removeItem(k));
    document.getElementById('admin-screen').classList.add('d-none');
    document.getElementById('login-screen').style.display = 'flex';
});

async function showAdmin(email) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-email').textContent = email;
    document.getElementById('drawer-admin-email').textContent = email;

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, must_change_password')
        .eq('id', sessionData.session.user.id)
        .single();
      currentAdminRole = profile?.role || null;

      if (profile?.must_change_password) {
        showChangePasswordScreen();
        return;
      }
    }

    document.getElementById('admin-screen').classList.remove('d-none');
    updateAdminUIPermissions();
    await loadCategories();
    await loadProductsTable();

    if (sessionData.session?.user?.id) {
        supabase.rpc('log_admin_login', { admin_id: sessionData.session.user.id }).then(({ error }) => {
            if (error) console.error('Failed to log login:', error);
        });
    }
}

function showChangePasswordScreen() {
    document.getElementById('admin-screen').classList.add('d-none');
    document.getElementById('change-password-screen').classList.remove('d-none');
}

async function handleChangePassword() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const errEl = document.getElementById('change-password-error');
    errEl.classList.add('d-none');

    if (!newPassword || !confirmPassword) {
        errEl.textContent = 'Veuillez remplir tous les champs.';
        errEl.classList.remove('d-none');
        return;
    }

    if (newPassword.length < 6) {
        errEl.textContent = 'Le mot de passe doit faire au moins 6 caractères.';
        errEl.classList.remove('d-none');
        return;
    }

    if (newPassword !== confirmPassword) {
        errEl.textContent = 'Les mots de passe ne correspondent pas.';
        errEl.classList.remove('d-none');
        return;
    }

    const btn = document.getElementById('change-password-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Changement…';

    try {
        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
        if (updateError) throw updateError;

        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
            await supabase
                .from('profiles')
                .update({ must_change_password: false })
                .eq('id', sessionData.session.user.id);
        }

        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        document.getElementById('change-password-screen').classList.add('d-none');
        document.getElementById('admin-screen').classList.remove('d-none');

        updateAdminUIPermissions();
        await loadCategories();
        await loadProductsTable();

        if (sessionData.session?.user?.id) {
            supabase.rpc('log_admin_login', { admin_id: sessionData.session.user.id }).then(({ error }) => {
                if (error) console.error('Failed to log login:', error);
            });
        }

        showAlert('Mot de passe changé avec succès.', 'success');
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-key me-1"></i> Changer le mot de passe';
    }
}

document.getElementById('change-password-btn')?.addEventListener('click', handleChangePassword);
['new-password', 'confirm-password'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') handleChangePassword(); })
);

const { data: { session } } = await supabase.auth.getSession();
if (session) showAdmin(session.user.email);

async function loadCategories() {
    const { data } = await supabase.from('categories').select('*').order('sort_order');
    categories = data || [];
    refreshCategorySelect();
}

function refreshCategorySelect() {
    const select = document.getElementById('field-category');
    const current = select.value;
    select.innerHTML = '<option value="">-- Choisir --</option>' +
        categories.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
    select.value = current;
}

async function loadProductsTable() {
    const tbody = document.getElementById('products-table-body');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Chargement…</td></tr>';
    const { data: products, error } = await supabase.from('products').select('*').order('category').order('sort_order');
    if (error) { tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center py-3">Erreur : ${error.message}</td></tr>`; return; }
    allProducts = products || [];
    document.getElementById('product-count').textContent = `${allProducts.length} produit(s)`;
    if (!allProducts.length) { tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Aucun produit.</td></tr>'; return; }
    tbody.innerHTML = allProducts.map(p => {
        const catLabel = categories.find(c => c.id === p.category)?.label || p.category;
        const price = Number(p.price).toLocaleString('fr-FR');
        const badge = p.active ? '<span class="badge badge-active">Visible</span>' : '<span class="badge badge-inactive">Masqué</span>';
        const colors = safeJSON(p.colors);
        const colorChips = colors.length > 0
            ? colors.slice(0, 5).map(c =>
                `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${c.hex};border:1px solid rgba(0,0,0,.15);margin-right:3px;" title="${c.name}"></span>`
            ).join('') + (colors.length > 5 ? `<small class="text-muted">+${colors.length - 5}</small>` : '')
            : '<small class="text-muted">—</small>';
        return `<tr>
        <td class="ps-3"><img src="${p.image_url}" class="product-img-thumb" alt=""
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'45\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'%23dee2e6\'/%3E%3C/svg%3E'"></td>
        <td><div class="fw-semibold">${p.name}</div><small class="text-muted">${p.id}</small></td>
        <td><small>${catLabel}</small></td>
        <td class="fw-semibold text-primary">${price}</td>
        <td>${colorChips}</td>
        <td>${badge}</td>
        <td class="text-end pe-3">
            <button class="btn btn-sm btn-outline-secondary me-1 btn-edit-product" data-id="${p.id}"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger btn-delete-product" data-id="${p.id}" data-name="${p.name}"><i class="bi bi-trash"></i></button>
        </td>
    </tr>`;
    }).join('');
    document.querySelectorAll('.btn-edit-product').forEach(btn => btn.addEventListener('click', () => openEditProduct(btn.dataset.id)));
    document.querySelectorAll('.btn-delete-product').forEach(btn => btn.addEventListener('click', () => openDelete('product', btn.dataset.id, btn.dataset.name)));
}

async function loadCategoriesTable() {
    const tbody = document.getElementById('categories-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Chargement…</td></tr>';
    const { data: cats, error } = await supabase.from('categories').select('*').order('sort_order');
    if (error) { tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center py-3">Erreur : ${error.message}</td></tr>`; return; }
    categories = cats || [];
    refreshCategorySelect();
    document.getElementById('category-count').textContent = `${categories.length} catégorie(s)`;
    if (!categories.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Aucune catégorie.</td></tr>'; return; }
    const { data: prods } = await supabase.from('products').select('category');
    const countMap = {};
    (prods || []).forEach(p => { countMap[p.category] = (countMap[p.category] || 0) + 1; });
    tbody.innerHTML = categories.map(c => `<tr>
    <td class="ps-3"><code class="text-secondary">${c.id}</code></td>
    <td class="fw-semibold">${c.label}</td>
    <td>${c.sort_order}</td>
    <td><span class="badge bg-secondary">${countMap[c.id] || 0} produit(s)</span></td>
    <td class="text-end pe-3">
        <button class="btn btn-sm btn-outline-secondary me-1 btn-edit-cat" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger btn-delete-cat" data-id="${c.id}" data-name="${c.label}" data-count="${countMap[c.id] || 0}"><i class="bi bi-trash"></i></button>
    </td>
</tr>`).join('');
    document.querySelectorAll('.btn-edit-cat').forEach(btn => btn.addEventListener('click', () => openEditCategory(btn.dataset.id)));
    document.querySelectorAll('.btn-delete-cat').forEach(btn => btn.addEventListener('click', () => openDelete('category', btn.dataset.id, btn.dataset.name, btn.dataset.count)));
}

document.getElementById('new-product-btn').addEventListener('click', () => {
    editingId = null; uploadedImageUrl = null;
    document.getElementById('productModalLabel').textContent = 'Nouveau produit';
    document.getElementById('field-id').disabled = false;
    const autoId = 'P' + Date.now().toString(36).toUpperCase().slice(-5);
    clearProductForm();
    document.getElementById('field-id').value = autoId;
    document.getElementById('form-error').classList.add('d-none');
});

function openEditProduct(id) {
    editingId = id; uploadedImageUrl = null;
    const p = allProducts.find(x => x.id === id);
    document.getElementById('productModalLabel').textContent = 'Modifier le produit';
    document.getElementById('field-id').value = p.id;
    document.getElementById('field-id').disabled = true;
    document.getElementById('field-name').value = p.name;
    document.getElementById('field-description').value = p.description;
    document.getElementById('field-price').value = p.price;
    document.getElementById('field-sort').value = p.sort_order;
    document.getElementById('field-image-url').value = p.image_url;
    document.getElementById('field-category').value = p.category;
    document.getElementById('field-active').checked = p.active;
    document.getElementById('form-error').classList.add('d-none');

    const preview = document.getElementById('upload-preview');
    if (p.image_url) {
        preview.src = p.image_url; preview.classList.remove('d-none');
        document.getElementById('upload-placeholder').classList.add('d-none');
        document.getElementById('re-crop-btn').style.display = '';
    } else {
        preview.classList.add('d-none');
        document.getElementById('upload-placeholder').classList.remove('d-none');
        document.getElementById('re-crop-btn').style.display = 'none';
    }
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('upload-status').innerHTML = '';

    clearColorsList();
    safeJSON(p.colors).forEach(c => addColorRow(c.hex, c.name, c.image_url || ''));

    clearSpecsList();
    safeJSON(p.specs).forEach(s => addSpecRow(s.key, s.value));

    productModal.show();
}

document.getElementById('save-product-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('form-error');
    errEl.classList.add('d-none');

    const id = document.getElementById('field-id').value.trim().toUpperCase();
    const name = document.getElementById('field-name').value.trim();
    const description = document.getElementById('field-description').value.trim();
    const price = parseInt(document.getElementById('field-price').value, 10);
    const sort_order = parseInt(document.getElementById('field-sort').value, 10) || 0;
    const category = document.getElementById('field-category').value;
    const active = document.getElementById('field-active').checked;
    const image_url = document.getElementById('field-image-url').value.trim();

    if (!id || !name || !category || isNaN(price)) {
        errEl.textContent = 'Veuillez remplir tous les champs obligatoires (Nom, Catégorie, Prix).';
        errEl.classList.remove('d-none'); return;
    }

    const colors = [];
    document.querySelectorAll('#colors-list .color-row').forEach(row => {
        const hex = row.querySelector('.color-hex').value;
        const nm  = row.querySelector('.color-name-input').value.trim();
        const img = row.querySelector('.color-img-input')?.value.trim() || '';
        if (nm) colors.push({ hex, name: nm, image_url: img });
    });

    const specs = [];
    document.querySelectorAll('#specs-list .spec-row').forEach(row => {
        const key = row.querySelector('.spec-key-input').value.trim();
        const val = row.querySelector('.spec-val-input').value.trim();
        if (key && val) specs.push({ key, value: val });
    });

    const payload = { name, description, price, sort_order, image_url, category, active, colors, specs };
    let error;
    if (editingId) { ({ error } = await supabase.from('products').update(payload).eq('id', editingId)); }
    else { ({ error } = await supabase.from('products').insert({ id, ...payload })); }

    if (error) {
        errEl.textContent = 'Erreur : ' + (error.message.includes('duplicate') ? `L'ID "${id}" existe déjà.` : error.message);
        errEl.classList.remove('d-none'); return;
    }
    productModal.hide();
    showAlert(`Produit "${name}" enregistré avec succès.`, 'success');
    await loadProductsTable();
});

document.getElementById('add-color-btn').addEventListener('click', () => addColorRow());

function addColorRow(hex = '#000000', name = '', image_url = '') {
    const list = document.getElementById('colors-list');
    const row = document.createElement('div');
    row.className = 'color-row';
    row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #f0f0f0;';

    row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="color"
                class="form-control form-control-color color-hex"
                value="${hex}"
                title="Choisir couleur"
                style="width:44px;height:36px;">
            <input type="text"
                class="form-control form-control-sm color-name-input"
                placeholder="Nom (ex: Noir, Rouge Corail…)"
                value="${escapeAttr(name)}"
                style="flex:1;">
            <button type="button"
                class="btn btn-sm btn-outline-danger remove-color-btn"
                title="Supprimer">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <div class="color-img-thumb"
                style="width:48px;height:36px;border-radius:6px;border:1px solid #dee2e6;overflow:hidden;flex-shrink:0;background:#f8f9fa;display:flex;align-items:center;justify-content:center;">
                ${image_url
                    ? `<img src="${escapeAttr(image_url)}" style="width:100%;height:100%;object-fit:cover;" alt="">`
                    : `<i class="bi bi-image text-muted" style="font-size:14px;"></i>`}
            </div>
            <input type="text"
                class="form-control form-control-sm color-img-input"
                placeholder="URL image pour cette couleur (optionnel)"
                value="${escapeAttr(image_url)}"
                style="flex:1;">
            <button type="button"
                class="btn btn-sm btn-outline-secondary color-upload-trigger"
                title="Uploader une image pour cette couleur">
                <i class="bi bi-upload"></i>
            </button>
        </div>`;

    row.querySelector('.color-img-input').addEventListener('input', function () {
        const thumb = row.querySelector('.color-img-thumb');
        if (this.value) {
            thumb.innerHTML = `<img src="${this.value}"
                style="width:100%;height:100%;object-fit:cover;" alt=""
                onerror="this.parentElement.innerHTML='<i class=\\'bi bi-x text-danger\\'></i>'">`;
        } else {
            thumb.innerHTML = `<i class="bi bi-image text-muted" style="font-size:14px;"></i>`;
        }
    });

    row.querySelector('.color-upload-trigger').addEventListener('click', () => {
        colorUploadTargetRow = row;
        const tmp = document.createElement('input');
        tmp.type = 'file';
        tmp.accept = 'image/*';
        tmp.addEventListener('change', () => {
            if (!tmp.files[0]) { colorUploadTargetRow = null; return; }
            if (tmp.files[0].size > 5 * 1024 * 1024) {
                showAlert('Image trop lourde (max 5 Mo).', 'danger');
                colorUploadTargetRow = null;
                return;
            }
            openCropperModal(tmp.files[0]);
        });
        tmp.click();
    });

    row.querySelector('.remove-color-btn').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function clearColorsList() { document.getElementById('colors-list').innerHTML = ''; }

document.getElementById('add-spec-btn').addEventListener('click', () => addSpecRow());

function addSpecRow(key = '', value = '') {
    const list = document.getElementById('specs-list');
    const row = document.createElement('div');
    row.className = 'spec-row';
    row.innerHTML = `
    <input type="text" class="form-control form-control-sm spec-key-input" placeholder="Caractéristique (ex: Capacité)" value="${escapeAttr(key)}">
    <span class="spec-arrow">→</span>
    <input type="text" class="form-control form-control-sm spec-val-input" placeholder="Valeur (ex: 1 To)" value="${escapeAttr(value)}">
    <button type="button" class="btn btn-sm btn-outline-danger remove-spec-btn" title="Supprimer">
        <i class="bi bi-x-lg"></i>
    </button>`;
    row.querySelector('.remove-spec-btn').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function clearSpecsList() { document.getElementById('specs-list').innerHTML = ''; }

document.getElementById('new-category-btn').addEventListener('click', () => {
    editingCatId = null;
    document.getElementById('categoryModalLabel').textContent = 'Nouvelle catégorie';
    document.getElementById('cat-field-id').value = '';
    document.getElementById('cat-field-id').disabled = false;
    document.getElementById('cat-field-label').value = '';
    document.getElementById('cat-field-sort').value = '';
    document.getElementById('cat-id-preview').textContent = '';
    document.getElementById('cat-form-error').classList.add('d-none');
});

function openEditCategory(id) {
    editingCatId = id;
    const c = categories.find(x => x.id === id);
    document.getElementById('categoryModalLabel').textContent = 'Modifier la catégorie';
    document.getElementById('cat-field-id').value = c.id;
    document.getElementById('cat-field-id').disabled = true;
    document.getElementById('cat-field-label').value = c.label;
    document.getElementById('cat-field-sort').value = c.sort_order;
    document.getElementById('cat-id-preview').textContent = `→ ID : ${c.id}`;
    document.getElementById('cat-form-error').classList.add('d-none');
    categoryModal.show();
}

document.getElementById('save-category-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('cat-form-error');
    errEl.classList.add('d-none');
    const id = document.getElementById('cat-field-id').value.trim().toLowerCase().replace(/\s+/g, '-');
    const label = document.getElementById('cat-field-label').value.trim();
    const sort_order = parseInt(document.getElementById('cat-field-sort').value, 10) || 0;
    if (!id || !label) { errEl.textContent = "Le libellé est obligatoire."; errEl.classList.remove('d-none'); return; }
    let error;
    if (editingCatId) { ({ error } = await supabase.from('categories').update({ label, sort_order }).eq('id', editingCatId)); }
    else { ({ error } = await supabase.from('categories').insert({ id, label, sort_order })); }
    if (error) { errEl.textContent = 'Erreur : ' + (error.message.includes('duplicate') ? `L'ID "${id}" existe déjà.` : error.message); errEl.classList.remove('d-none'); return; }
    categoryModal.hide();
    showAlert(`Catégorie "${label}" enregistrée avec succès.`, 'success');
    await loadCategoriesTable();
});

function openDelete(type, id, name, count = 0) {
    deletingId = id; deletingType = type;
    document.getElementById('delete-item-name').textContent = name;
    const warn = document.getElementById('delete-warning');
    const btn = document.getElementById('confirm-delete-btn');
    if (type === 'category' && parseInt(count) > 0) { warn.classList.remove('d-none'); btn.disabled = true; }
    else { warn.classList.add('d-none'); btn.disabled = false; }
    deleteModal.show();
}

document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
    const table = deletingType === 'product' ? 'products' : 'categories';
    const { error } = await supabase.from(table).delete().eq('id', deletingId);
    deleteModal.hide();
    if (error) { showAlert('Erreur lors de la suppression : ' + error.message, 'danger'); return; }
    showAlert('Élément supprimé.', 'warning');
    if (deletingType === 'product') await loadProductsTable();
    else await loadCategoriesTable();
});

function openCropperModal(file) {
    pendingFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const cropImg = document.getElementById('cropper-image');
        if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
        currentFlipH = 1; currentFlipV = 1;
        cropImg.src = e.target.result;
        productModal.hide();
        document.getElementById('cropperModal').addEventListener('shown.bs.modal', () => {
            cropperInstance = new Cropper(cropImg, {
                aspectRatio: 4 / 3,
                viewMode: 0,
                dragMode: 'move',
                autoCropArea: 0.85,
                responsive: true,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
                zoom(event) {
                    const slider = document.getElementById('zoom-slider');
                    const ratio = Math.min(Math.max(event.detail.ratio, 0.1), 3);
                    slider.value = (ratio - 0.1) / (3 - 0.1);
                }
            });
        }, { once: true });
        cropperModal.show();
    };
    reader.readAsDataURL(file);
}

document.getElementById('zoom-slider').addEventListener('input', function () {
    if (!cropperInstance) return;
    const ratio = 0.1 + parseFloat(this.value) * (3 - 0.1);
    cropperInstance.zoomTo(ratio);
});

document.getElementById('rotate-left-btn').addEventListener('click', () => { if (cropperInstance) cropperInstance.rotate(-90); });
document.getElementById('rotate-right-btn').addEventListener('click', () => { if (cropperInstance) cropperInstance.rotate(90); });

document.getElementById('flip-h-btn').addEventListener('click', () => {
    if (!cropperInstance) return;
    currentFlipH *= -1;
    cropperInstance.scaleX(currentFlipH);
});

document.getElementById('reset-crop-btn').addEventListener('click', () => {
    if (!cropperInstance) return;
    cropperInstance.reset();
    currentFlipH = 1; currentFlipV = 1;
    document.getElementById('zoom-slider').value = 0;
});

function cancelCrop() {
    cropperModal.hide();
    document.getElementById('cropperModal').addEventListener('hidden.bs.modal', () => {
        if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
        pendingFile = null;
        productModal.show();
    }, { once: true });
}
document.getElementById('cropper-cancel-btn').addEventListener('click', cancelCrop);
document.getElementById('cropper-cancel-btn2').addEventListener('click', cancelCrop);

document.getElementById('cropper-validate-btn').addEventListener('click', async () => {
    if (!cropperInstance) return;
    const btn = document.getElementById('cropper-validate-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Upload en cours…';

    const canvas = cropperInstance.getCroppedCanvas({
        width: 800, height: 600,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillColor: '#ffffff',
    });

    canvas.toBlob(async (blob) => {
        if (!blob) {
            showAlert('Erreur lors de la conversion de l\'image.', 'danger');
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Valider et envoyer';
            return;
        }

        cropperModal.hide();
        document.getElementById('cropperModal').addEventListener('hidden.bs.modal', async () => {
            if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }

            const croppedPreviewUrl = URL.createObjectURL(blob);

            const targetRow = colorUploadTargetRow;

            if (targetRow) {
                const thumb = targetRow.querySelector('.color-img-thumb');
                thumb.innerHTML = `<img src="${croppedPreviewUrl}"
                    style="width:100%;height:100%;object-fit:cover;" alt="">`;
                colorUploadTargetRow = null;
            } else {
                const preview = document.getElementById('upload-preview');
                preview.src = croppedPreviewUrl;
                preview.classList.remove('d-none');
                document.getElementById('upload-placeholder').classList.add('d-none');
                document.getElementById('re-crop-btn').style.display = '';
            }

            productModal.show();

            const url = await uploadBlob(blob, 'webp');

            if (url) {
                if (targetRow) {
                    targetRow.querySelector('.color-img-input').value = url;
                    targetRow.querySelector('.color-img-thumb').innerHTML =
                        `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
                } else {
                    uploadedImageUrl = url;
                    document.getElementById('field-image-url').value = url;
                }
            }

            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Valider et envoyer';
        }, { once: true });

    }, 'image/webp', 0.88);
});

document.getElementById('re-crop-btn').addEventListener('click', () => {
    if (pendingFile) { openCropperModal(pendingFile); }
    else { document.getElementById('field-image-file').click(); }
});

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('field-image-file');

uploadZone.addEventListener('click', (e) => { if (e.target.closest('#re-crop-btn')) return; fileInput.click(); });
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFileSelected(fileInput.files[0]); fileInput.value = ''; });

function handleFileSelected(file) {
    if (file.size > 5 * 1024 * 1024) { showAlert('L\'image est trop lourde (max 5 Mo).', 'danger'); return; }
    if (!file.type.startsWith('image/')) { showAlert('Veuillez sélectionner un fichier image.', 'danger'); return; }
    openCropperModal(file);
}

async function uploadBlob(blob, ext) {
    const fileName = `product_${Date.now()}.${ext}`;
    const progressEl = document.getElementById('upload-progress');
    const barEl = document.getElementById('upload-bar');
    const statusEl = document.getElementById('upload-status');

    progressEl.style.display = 'block';
    barEl.style.width = '30%';
    barEl.style.background = '#0d6efd';
    statusEl.innerHTML = '<span class="text-primary"><span class="spinner-border spinner-border-sm me-1"></span>Envoi en cours…</span>';

    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, {
        upsert: true,
        contentType: `image/${ext}`
    });

    if (error) {
        barEl.style.width = '100%';
        barEl.style.background = '#dc3545';
        statusEl.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle me-1"></i>${error.message}</span>`;
        return null;
    }

    barEl.style.width = '100%';
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle me-1"></i>Image uploadée avec succès ! (WebP 800×600)</span>';
    return urlData.publicUrl;
}

function clearProductForm() {
    ['field-name', 'field-description', 'field-price', 'field-sort', 'field-image-url'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('field-id').value = '';
    document.getElementById('field-category').value = '';
    document.getElementById('field-active').checked = true;
    document.getElementById('upload-preview').classList.add('d-none');
    document.getElementById('upload-placeholder').classList.remove('d-none');
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('upload-status').innerHTML = '';
    document.getElementById('field-image-file').value = '';
    document.getElementById('re-crop-btn').style.display = 'none';
    clearColorsList();
    clearSpecsList();
    uploadedImageUrl = null;
    pendingFile = null;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showAlert(msg, type) {
    const el = document.getElementById('admin-alert');
    el.className = `alert alert-${type} alert-dismissible fade show`;
    el.innerHTML = `${msg} <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    el.classList.remove('d-none');
    setTimeout(() => el.classList.add('d-none'), 4000);
}

function safeJSON(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val); } catch { return []; }
}

function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let adminConversations = [];
let adminActiveConvId = null;
let adminMsgSub = null;
let adminPollingTimeout = null;
let adminLastMessageAt = null;
const adminProfileCache = {};
let adminChatsLoading = false;

async function loadAdminChats() {
    if (adminChatsLoading) return;
    adminChatsLoading = true;
    try {
    const user = (await supabase.auth.getSession()).data.session?.user;
    if (!user) return;

    const { data: parts } = await supabase
        .from('conversation_participants')
        .select('conversation_id, unread_count, last_read_at, conversations(*)')
        .eq('profile_id', user.id)
        .is('deleted_at', null);

    adminConversations = (parts || []).map(p => ({ ...p.conversations, unread_count: p.unread_count, last_read_at: p.last_read_at }));

    const convIds = adminConversations.map(c => c.id);
    if (convIds.length > 0) {
        const { data: allParts } = await supabase
            .rpc('get_batch_conv_participants', { conv_ids: convIds, my_id: user.id });
        const partsByConv = {};
        (allParts || []).forEach(p => {
            if (!partsByConv[p.conv_id]) partsByConv[p.conv_id] = [];
            partsByConv[p.conv_id].push(p);
        });
        adminConversations.forEach(conv => {
            conv.participants = partsByConv[conv.id] || [];
            conv.withName = conv.participants[0]?.full_name || conv.participants[0]?.email || 'Client inconnu';
        });
    }

    renderAdminChatList();
    } catch (err) {
        console.error('Erreur chargement conversations admin:', err);
    } finally {
        adminChatsLoading = false;
    }
}

function renderAdminChatList() {
    const list = document.getElementById('admin-chat-list');
    if (adminConversations.length === 0) {
        list.innerHTML = '<div class="text-center py-4 text-muted">Aucune conversation.</div>';
        return;
    }

    adminConversations.sort((a, b) => (b.last_message_at || b.created_at) - (a.last_message_at || a.created_at));

    list.innerHTML = adminConversations.map(conv => {
        const subject = conv.subject || '';
        const showProduct = subject && subject !== 'Support Trusttec';
        return `
        <div class="d-flex align-items-center gap-2 p-3 border-bottom admin-conv-item ${adminActiveConvId === conv.id ? 'bg-light' : ''}"
             style="cursor:pointer;" data-conv-id="${conv.id}">
            <div style="width:36px;height:36px;border-radius:50%;background:#0d6efd;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">
                ${conv.withName?.charAt(0).toUpperCase() || '?'}
            </div>
            <div style="flex:1;min-width:0;">
                <div class="fw-semibold small">${conv.withName || 'Client'}</div>
                ${showProduct ? `<div style="font-size:11px;color:#0d6efd;font-weight:600;line-height:1.3;">${subject}</div>` : ''}
                <div class="text-muted small text-truncate">${conv.last_message || 'Aucun message'}</div>
            </div>
            <div class="d-flex align-items-center gap-1" style="flex-shrink:0;">
                <div class="text-end">
                    <div class="text-muted" style="font-size:10px;">${conv.last_message_at ? formatChatTime(conv.last_message_at) : ''}</div>
                    ${conv.last_message_at && conv.last_read_at && new Date(conv.last_message_at) > new Date(conv.last_read_at) ? `<span class="badge bg-danger rounded-pill">!</span>` : ''}
                </div>
                <button class="btn btn-sm text-danger border-0 admin-conv-delete" data-conv-id="${conv.id}" data-conv-name="${conv.withName || 'Client'}" title="Supprimer cette conversation" style="opacity:0.4;transition:opacity .15s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.4'">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        </div>`;}).join('');

    list.querySelectorAll('.admin-conv-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.admin-conv-delete')) return;
            openAdminConversation(el.dataset.convId);
        });
    });

    list.querySelectorAll('.admin-conv-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const convId = btn.dataset.convId;
            const convName = btn.dataset.convName;
            document.getElementById('delete-conv-msg').innerHTML = `Masquer la conversation avec <strong>${convName}</strong> ?<br><small class="text-muted">Le client verra encore ses messages.</small>`;
            document.getElementById('confirm-delete-conv-btn').onclick = () => {
                deleteConvModal.hide();
                deleteAdminConversation(convId);
            };
            deleteConvModal.show();
        });
    });

    document.getElementById('chat-conv-count').textContent = `${adminConversations.length} conversation(s)`;
}

async function openAdminConversation(convId) {
    adminActiveConvId = convId;
    const conv = adminConversations.find(c => c.id === convId);
    if (!conv) return;

    const subject = conv.subject || '';
    const productInfo = subject && subject !== 'Support Trusttec' ? ` · ${subject}` : '';
    document.getElementById('admin-chat-with').textContent = `Chat avec : ${conv.withName}${productInfo}`;
    document.getElementById('admin-msg-input-area').style.display = 'flex';

    const user = (await supabase.auth.getSession()).data.session?.user;
    await supabase.rpc('mark_conversation_read', {
        p_conv_id: convId,
        p_profile_id: user.id
    });

    renderAdminChatList();
    await loadAdminMessages(convId);

    const convData = adminConversations.find(c => c.id === convId);
    if (convData?.last_message_at) adminLastMessageAt = convData.last_message_at;

    subscribeAdminMessages(convId);
}

async function loadAdminMessages(convId) {
    const list = document.getElementById('admin-msg-list');
    list.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Chargement...</div>';

    const { data: messages, error } = await supabase
        .rpc('get_conv_messages', { conv_id: convId });

    if (error) {
        console.error('Erreur chargement messages admin:', error);
        list.innerHTML = '<div class="text-center py-4 text-muted"><i class="bi bi-exclamation-triangle text-danger fs-4 d-block mb-2"></i><p class="text-danger">Erreur de chargement.</p><button class="btn btn-sm btn-outline-primary mt-2" id="admin-retry-msgs"><i class="bi bi-arrow-repeat me-1"></i>Réessayer</button></div>';
        document.getElementById('admin-retry-msgs')?.addEventListener('click', () => loadAdminMessages(convId));
        return;
    }

    const user = (await supabase.auth.getSession()).data.session?.user;

    if (!messages || messages.length === 0) {
        list.innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-chat fs-1 d-block mb-2"></i>Aucun message. Écrivez à votre client !</div>';
        return;
    }

    list.innerHTML = messages.map(msg => {
        const isSent = msg.sender_id === user?.id;
        const nameLabel = isSent ? 'Vous' : escapeHtml(msg.sender_name || 'Inconnu');
        return `
        <div class="d-flex mb-2 ${isSent ? 'justify-content-end' : 'justify-content-start'}">
            <div class="p-2 px-3 rounded-3" style="max-width:75%;${isSent ? 'background:#0d6efd;color:white;border-bottom-right-radius:4px;' : 'background:white;border:1px solid #dee2e6;border-bottom-left-radius:4px;'}">
                <div style="font-size:11px;opacity:0.7;margin-bottom:2px;">${nameLabel}</div>
                <div style="font-size:14px;">${escapeHtml(msg.content)}</div>
                <div style="font-size:10px;opacity:0.6;margin-top:4px;">${formatChatTime(msg.created_at)}</div>
            </div>
        </div>`;
    }).join('');

    list.scrollTop = list.scrollHeight;
}

function subscribeAdminMessages(convId) {
    if (adminPollingTimeout) {
        clearTimeout(adminPollingTimeout);
        adminPollingTimeout = null;
    }
    if (adminMsgSub) {
        adminMsgSub.unsubscribe();
        adminMsgSub = null;
    }

    adminLastMessageAt = null;

    async function pollAdminMessages() {
        if (adminActiveConvId !== convId) return;

        try {
            const { data: conv } = await supabase
                .from('conversations')
                .select('last_message_at')
                .eq('id', convId)
                .single();

            if (conv?.last_message_at && conv.last_message_at !== adminLastMessageAt) {
                adminLastMessageAt = conv.last_message_at;
                await loadAdminMessages(convId);
            }
        } catch (e) {
            console.warn('[ADMIN POLL] Erreur:', e.message);
        } finally {
            if (adminActiveConvId === convId) {
                adminPollingTimeout = setTimeout(pollAdminMessages, 3000);
            }
        }
    }

    pollAdminMessages();
}

document.getElementById('admin-msg-send')?.addEventListener('click', sendAdminMessage);
document.getElementById('admin-msg-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdminMessage(); }
});

async function sendAdminMessage() {
    const input = document.getElementById('admin-msg-input');
    const content = input.value.trim();
    if (!content || !adminActiveConvId) return;

    const user = (await supabase.auth.getSession()).data.session?.user;
    if (!user) return;

    input.disabled = true;

    try {
        await supabase.rpc('send_admin_msg', {
            conv_id: adminActiveConvId,
            sender_id: user.id,
            content
        });
        input.value = '';
    } catch (err) {
        console.error('Erreur envoi message admin:', err);
        showAlert("Erreur d'envoi. Vérifiez votre connexion.", 'danger');
    } finally {
        input.disabled = false;
        input.focus();
    }
}

async function deleteAdminConversation(convId) {
    const user = (await supabase.auth.getSession()).data.session?.user;
    if (!user) return;

    if (adminActiveConvId === convId) {
        adminActiveConvId = null;
        document.getElementById('admin-chat-with').textContent = 'Chat';
        document.getElementById('admin-msg-list').innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-chat fs-1 d-block mb-2"></i>Sélectionnez une conversation</div>';
        document.getElementById('admin-msg-input-area').style.display = 'none';
        if (adminPollingTimeout) { clearTimeout(adminPollingTimeout); adminPollingTimeout = null; }
        if (adminMsgSub) { adminMsgSub.unsubscribe(); adminMsgSub = null; }
    }

    const { error } = await supabase.rpc('delete_admin_conversation', { conv_id: convId, admin_id: user.id });
    if (error) {
        showAlert('Erreur lors de la suppression : ' + error.message, 'danger');
        return;
    }
    adminConversations = adminConversations.filter(c => c.id !== convId);
    renderAdminChatList();
    showAlert('Conversation masquée.', 'warning');
}

function formatChatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── STATISTIQUES ──────────────────────────────────────────────────────────

async function loadStats() {

  function destroyChart(instance) {
    if (instance) instance.destroy();
  }

  function startOfMonth() {
    const d = new Date();
    d.setDate(1); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  // ── Lancer toutes les requêtes indépendantes en parallèle ────────────
  const [
    clientsResult,
    productsResult,
    categoriesResult,
    adminProfilesResult,
  ] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, phone, created_at, last_seen_at')
      .eq('role', 'customer')
      .is('deleted_at', null),

    supabase.from('products').select('category, active'),

    supabase.from('categories').select('id, label'),

    supabase.from('profiles')
      .select('id')
      .in('role', ['admin', 'super_admin'])
      .is('deleted_at', null),
  ]);

  // Fallback si deleted_at n'existe pas encore
  let allClients = clientsResult.data;
  if (!allClients) {
    const { data: fallback } = await supabase
      .from('profiles')
      .select('id, full_name, phone, created_at')
      .eq('role', 'customer');
    allClients = (fallback || []).map(c => ({ ...c, last_seen_at: null }));
  }

  const products   = productsResult.data   || [];
  const categories = categoriesResult.data || [];
  const adminProfileIdArray = (adminProfilesResult.data || []).map(a => a.id);

  const total = allClients?.length ?? 0;
  const newThisMonth = allClients?.filter(p => p.created_at >= startOfMonth()).length ?? 0;
  const complete = allClients?.filter(p => p.full_name?.trim() && p.phone?.trim()).length ?? 0;
  const pctComplete = total > 0 ? Math.round((complete / total) * 100) : 0;

  document.getElementById('stat-total-clients').textContent = total;
  document.getElementById('stat-new-this-month').textContent =
    newThisMonth > 0 ? `+${newThisMonth} ce mois` : 'Aucun ce mois';
  document.getElementById('stat-profiles-complete').textContent = complete;
  document.getElementById('stat-profiles-complete-pct').textContent = `${pctComplete}% du total`;

  const clientIds = allClients?.map(c => c.id) ?? [];

  let clientsWithChat = 0;
  if (clientIds.length > 0) {
    const { data: chatParticipants } = await supabase
      .from('conversation_participants')
      .select('profile_id')
      .in('profile_id', clientIds);

    const uniqueChatters = new Set(chatParticipants?.map(p => p.profile_id) ?? []);
    clientsWithChat = uniqueChatters.size;
  }

  const pctChat = total > 0 ? Math.round((clientsWithChat / total) * 100) : 0;
  document.getElementById('stat-clients-chat').textContent = clientsWithChat;
  document.getElementById('stat-clients-chat-pct').textContent = `${pctChat}% du total`;

  let totalUnread = 0;
  if (clientIds.length > 0 && adminProfileIdArray.length > 0) {
    const { data: adminUnread } = await supabase
      .from('conversation_participants')
      .select('unread_count')
      .in('profile_id', adminProfileIdArray);

    totalUnread = adminUnread?.reduce((sum, r) => sum + (r.unread_count ?? 0), 0) ?? 0;
  }

  document.getElementById('stat-unread').textContent = totalUnread;

  // --- Activité & churn ---
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyAgoStr = thirtyDaysAgo.toISOString();

  const active = allClients?.filter(p => p.last_seen_at && p.last_seen_at >= thirtyAgoStr).length ?? 0;
  const neverSeen = allClients?.filter(p => !p.last_seen_at).length ?? 0;
  const inactive = total - active;

  const pctActive = total > 0 ? Math.round((active / total) * 100) : 0;

  document.getElementById('stat-active-clients').textContent = active;
  document.getElementById('stat-active-clients-pct').textContent = `${pctActive}% du total`;
  document.getElementById('stat-inactive-clients').textContent = inactive;
  document.getElementById('stat-inactive-clients-pct').textContent = neverSeen > 0
    ? `dont ${neverSeen} jamais vus`
    : 'tous déjà vus';
  document.getElementById('stat-never-seen').textContent = neverSeen;

  // --- Désinscriptions (churn_log) ---
  const { count: deletedCount } = await supabase
    .from('churn_log')
    .select('id', { count: 'exact', head: true });
  const pctDel = total > 0 ? Math.round((deletedCount ?? 0) / (total + (deletedCount ?? 0)) * 100) : 0;
  document.getElementById('stat-deleted').textContent = deletedCount ?? 0;
  document.getElementById('stat-deleted-pct').textContent = `${pctDel}% des inscrits`;

  const now = new Date();
  const labels12 = [];
  const counts12 = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    labels12.push(label);

    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    const monthEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString();
    const count = allClients?.filter(p =>
      p.created_at >= monthStart && p.created_at <= monthEnd
    ).length ?? 0;
    counts12.push(count);
  }

  destroyChart(chartRegistrations);
  chartRegistrations = new Chart(
    document.getElementById('chart-registrations'),
    {
      type: 'line',
      data: {
        labels: labels12,
        datasets: [{
          label: 'Inscriptions',
          data: counts12,
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13,110,253,0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    }
  );

  const catMap = {};
  categories?.forEach(c => { catMap[c.id] = c.label; });

  const catCounts = {};
  products?.forEach(p => {
    const key = catMap[p.category] ?? 'Sans catégorie';
    catCounts[key] = (catCounts[key] ?? 0) + 1;
  });

  const catLabels = Object.keys(catCounts);
  const catValues = Object.values(catCounts);
  const palette   = ['#0d6efd','#6610f2','#0dcaf0','#198754','#ffc107','#dc3545','#6c757d','#fd7e14'];

  destroyChart(chartCategories);
  chartCategories = new Chart(
    document.getElementById('chart-categories'),
    {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catValues,
          backgroundColor: palette.slice(0, catLabels.length),
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } }
        }
      }
    }
  );

  // ── 6 & 7 : Messages clients des 7 derniers jours ─────────────────────

  const days7 = [];
  const labels7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days7.push(d.toISOString().slice(0, 10));
    labels7.push(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }));
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // CLEF DU FIX : on filtre directement dans Supabase par sender_id IN (clientIds)
  // Plus besoin de requête adminProfileIds séparée — aucun risque d'inclusion accidentelle
  let recentMessages = [];
  if (clientIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('sender_id, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())
      .in('sender_id', clientIds);          // ← uniquement les clients connus
    recentMessages = msgs || [];
  }

  // Graphique messages par jour
  const msgByDay = {};
  days7.forEach(d => { msgByDay[d] = 0; });
  recentMessages.forEach(m => {
    const day = m.created_at.slice(0, 10);
    if (msgByDay[day] !== undefined) msgByDay[day]++;
  });

  destroyChart(chartMessages);
  chartMessages = new Chart(
    document.getElementById('chart-messages'),
    {
      type: 'bar',
      data: {
        labels: labels7,
        datasets: [{
          label: 'Messages clients',
          data: days7.map(d => msgByDay[d]),
          backgroundColor: 'rgba(13,110,253,0.7)',
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    }
  );

  // Top 5 clients les plus actifs
  const msgCountByClient = {};
  recentMessages.forEach(m => {
    if (m.sender_id) {
      msgCountByClient[m.sender_id] = (msgCountByClient[m.sender_id] ?? 0) + 1;
    }
  });

  const top5 = Object.entries(msgCountByClient)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topClientEl = document.getElementById('stat-top-clients');

  if (top5.length === 0) {
    topClientEl.innerHTML = `
      <li class="list-group-item text-center text-muted py-4">
        <i class="bi bi-chat-dots fs-4 d-block mb-1"></i>
        Aucun message client cette semaine
      </li>`;
    return;
  }

  const top5Ids = top5.map(([id]) => id);
  const { data: top5Profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', top5Ids);

  const profileMap = {};
  top5Profiles?.forEach(p => { profileMap[p.id] = p; });

  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  topClientEl.innerHTML = top5.map(([id, count], i) => {
    const p = profileMap[id];
    const name = p?.full_name?.trim() || p?.email?.split('@')[0] || 'Inconnu';
    return `
      <li class="list-group-item d-flex align-items-center justify-content-between px-3 py-2">
        <span>
          <span class="me-2">${medals[i]}</span>
          <span class="fw-semibold">${name}</span>
          ${p?.email ? `<small class="text-muted d-block" style="font-size:.75rem">${p.email}</small>` : ''}
        </span>
        <span class="badge bg-primary rounded-pill">${count} msg</span>
      </li>`;
  }).join('');

  // ── 8 : Temps de réponse moyen du support ────────────────────────────

  const { data: responseMsgs } = await supabase
    .from('messages')
    .select('conversation_id, sender_id, created_at')
    .gte('created_at', thirtyDaysAgo.toISOString());

  const msgsByConv = {};
  responseMsgs?.forEach(m => {
    if (!msgsByConv[m.conversation_id]) msgsByConv[m.conversation_id] = [];
    msgsByConv[m.conversation_id].push(m);
  });

  const adminSet = new Set(adminProfileIdArray);
  const responseDiffs = [];
  Object.values(msgsByConv).forEach(msgs => {
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let firstClient = null, firstAdmin = null;
    for (const m of msgs) {
      if (!firstClient && !adminSet.has(m.sender_id)) firstClient = new Date(m.created_at);
      if (firstClient && adminSet.has(m.sender_id)) { firstAdmin = new Date(m.created_at); break; }
    }
    if (firstClient && firstAdmin) responseDiffs.push(firstAdmin - firstClient);
  });

  const respEl = document.getElementById('stat-response-time');
  if (responseDiffs.length === 0) {
    respEl.textContent = '—';
    respEl.nextElementSibling.textContent = 'aucune donnée';
  } else {
    const avgMs = responseDiffs.reduce((a, b) => a + b, 0) / responseDiffs.length;
    const hours = Math.floor(avgMs / 3600000);
    const mins = Math.round((avgMs % 3600000) / 60000);
    respEl.textContent = hours >= 1 ? `${hours}h${mins > 0 ? mins : ''}` : `${mins} min`;
    respEl.nextElementSibling.textContent = `sur ${responseDiffs.length} conversations (30j)`;
  }

  // ── 9 : Heure de pointe des contacts ─────────────────────────────────

  const hourCounts = {};
  recentMessages.forEach(m => {
    const hour = new Date(m.created_at).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  });

  const peakEntries = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
  if (peakEntries.length === 0) {
    document.getElementById('stat-peak-hour').textContent = '—';
    document.getElementById('stat-peak-hour-label').textContent = 'aucun message cette semaine';
  } else {
    const [peakH, peakN] = peakEntries[0];
    document.getElementById('stat-peak-hour').textContent = `${peakH}h`;
    document.getElementById('stat-peak-hour-label').textContent =
      `pic d'activité : ${peakN} messages cette semaine`;
  }

  // ── 10 : Produit le plus demandé ─────────────────────────────────────

  const { data: conversations } = await supabase
    .from('conversations')
    .select('subject');

  const subjectCounts = {};
  conversations?.forEach(c => {
    const s = c.subject?.trim();
    if (s && s !== 'Support Trusttec') {
      subjectCounts[s] = (subjectCounts[s] ?? 0) + 1;
    }
  });

  const topSubjects = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1]);
  if (topSubjects.length === 0) {
    document.getElementById('stat-top-product').textContent = 'Aucun produit';
    document.getElementById('stat-top-product-count').textContent = 'pas de requête produit';
  } else {
    const [topProd, topN] = topSubjects[0];
    document.getElementById('stat-top-product').textContent = topProd;
    document.getElementById('stat-top-product-count').textContent = `${topN} demande(s)`;
  }
}

// ─── GESTION ADMINISTRATEURS ──────────────────────────────────────────────

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-admin`;

function updateAdminUIPermissions() {
  const isSuper = currentAdminRole === 'super_admin';
  const newAdminBtn = document.querySelector('[data-bs-target="#adminModal"]');
  if (newAdminBtn) {
    if (isSuper) {
      newAdminBtn.classList.remove('d-none');
    } else {
      newAdminBtn.classList.add('d-none');
    }
  }
  document.querySelectorAll('#nav-logs, #drawer-nav-logs').forEach(el => {
    if (el) el.style.display = isSuper ? '' : 'none';
  });
}

async function loadAdmins() {
    const tbody = document.getElementById('admins-table-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Chargement…</td></tr>';

    let { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, created_at')
        .in('role', ['admin', 'super_admin'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

    if (error || !profiles) {
      const fallback = await supabase
        .from('profiles')
        .select('id, email, full_name, role, created_at')
        .in('role', ['admin', 'super_admin'])
        .order('created_at', { ascending: false });
      profiles = fallback.data || [];
      error = fallback.error;
    }

    if (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger text-center py-3">Erreur : ${error.message}</td></tr>`;
        return;
    }

    document.getElementById('admin-count').textContent = `${profiles.length} admin(s)`;

    if (!profiles || profiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Aucun administrateur.</td></tr>';
        return;
    }

    const currentUser = (await supabase.auth.getSession()).data.session?.user;
    const isSuper = currentAdminRole === 'super_admin';

    profiles.sort((a, b) => {
        if (a.id === currentUser?.id) return -1;
        if (b.id === currentUser?.id) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    tbody.innerHTML = profiles.map(p => {
        const isSelf = p.id === currentUser?.id;
        const isTargetAdmin = isSuper && !isSelf && p.role === 'admin';
        const roleBadge = p.role === 'super_admin'
            ? '<span class="badge bg-danger"><i class="bi bi-star-fill me-1"></i>Super Admin</span>'
            : '<span class="badge bg-warning text-dark">Admin</span>';

        let actionsHtml;
        if (isSelf) {
            actionsHtml = '<span class="text-muted small">Vous</span>';
        } else if (isSuper) {
            actionsHtml = `
                ${isTargetAdmin ? `<button class="btn btn-sm btn-outline-primary me-1 btn-transfer-super" data-id="${p.id}" data-name="${p.full_name || p.email}"><i class="bi bi-arrow-up-circle"></i></button>` : ''}
                <button class="btn btn-sm btn-outline-danger btn-delete-admin" data-id="${p.id}" data-name="${p.full_name || p.email}"><i class="bi bi-trash"></i></button>`;
        } else {
            actionsHtml = '<span class="text-muted small">—</span>';
        }

        return `<tr>
            <td class="ps-3">${p.email || '—'}</td>
            <td>${p.full_name || '—'}</td>
            <td>${roleBadge}</td>
            <td class="text-end pe-3">${actionsHtml}</td>
        </tr>`;
    }).join('');

    document.querySelectorAll('.btn-delete-admin').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const name = btn.dataset.name;
            if (confirm(`Rétrograder ${name} au rôle client ?\nIl/elle ne pourra plus accéder à l'administration.`)) {
                demoteAdmin(id);
            }
        });
    });

    document.querySelectorAll('.btn-transfer-super').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const name = btn.dataset.name;
            if (confirm(`Transférer le rôle Super Admin à ${name} ?\n\nVous serez rétrogradé au rôle Admin et ne pourrez plus gérer les autres admins.\n\nCette action est irréversible.`)) {
                transferSuperAdmin(id);
            }
        });
    });
}

async function demoteAdmin(adminId) {
    const { error } = await supabase
        .from('profiles')
        .update({ role: 'customer' })
        .eq('id', adminId);

    if (error) {
        showAlert('Erreur : ' + error.message, 'danger');
        return;
    }
    showAlert('Admin rétrogradé au rôle client.', 'warning');
    loadAdmins();
}

async function transferSuperAdmin(targetAdminId) {
    const btn = document.querySelector(`.btn-transfer-super[data-id="${targetAdminId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }

    const { error } = await supabase.rpc('transfer_super_admin', {
        target_admin_id: targetAdminId,
    });

    if (error) {
        showAlert('Erreur : ' + error.message, 'danger');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-arrow-up-circle"></i>';
        }
        return;
    }

    showAlert(
        'Rôle Super Admin transféré avec succès ! Vous êtes maintenant Admin.',
        'success'
    );

    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

async function loadLogs() {
    const tbody = document.getElementById('logs-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Chargement…</td></tr>';

    const { data: logs, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center py-3">Erreur : ${error.message}</td></tr>`;
        return;
    }

    document.getElementById('log-count').textContent = `${logs.length} entrée(s)`;

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Aucune activité pour le moment.</td></tr>';
        return;
    }

    const actionLabels = {
        created: '<span class="badge bg-success">Création</span>',
        updated: '<span class="badge bg-primary">Modification</span>',
        deleted: '<span class="badge bg-danger">Suppression</span>',
        promoted: '<span class="badge bg-warning text-dark">Promotion</span>',
        demoted: '<span class="badge bg-secondary">Rétrogradation</span>',
        logged_in: '<span class="badge bg-info text-dark">Connexion</span>',
    };

    const entityIcons = {
        product: '<i class="bi bi-box-seam"></i>',
        category: '<i class="bi bi-tags"></i>',
        admin: '<i class="bi bi-shield-lock"></i>',
        session: '<i class="bi bi-door-open"></i>',
    };

    tbody.innerHTML = logs.map(log => {
        const date = new Date(log.created_at).toLocaleString('fr-FR', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const actionHtml = actionLabels[log.action] || escapeHtml(log.action);
        const iconHtml = entityIcons[log.entity_type] || '';
        const entityName = log.entity_name ? escapeHtml(log.entity_name) : '—';
        const adminName = log.admin_name ? escapeHtml(log.admin_name) : '<span class="text-muted">Système</span>';
        const detailsHtml = log.details
            ? '<small class="text-muted">' + escapeHtml(JSON.stringify(log.details)) + '</small>'
            : '—';
        return `<tr>
            <td class="ps-3 text-nowrap small text-muted">${date}</td>
            <td>${adminName}</td>
            <td>${actionHtml}</td>
            <td>${iconHtml} <span class="ms-1">${entityName}</span></td>
            <td class="text-end pe-3 small">${detailsHtml}</td>
        </tr>`;
  }).join('');

}

document.getElementById('refresh-logs-btn')?.addEventListener('click', loadLogs);
document.getElementById('refresh-stats-btn')?.addEventListener('click', loadStats);

document.getElementById('save-admin-btn')?.addEventListener('click', async () => {
    const errEl = document.getElementById('admin-form-error');
    errEl.classList.add('d-none');

    const name = document.getElementById('admin-field-name').value.trim();
    const email = document.getElementById('admin-field-email').value.trim();
    const password = document.getElementById('admin-field-password').value;

    if (!name || !email || !password) {
        errEl.textContent = 'Tous les champs sont obligatoires.';
        errEl.classList.remove('d-none');
        return;
    }

    if (password.length < 6) {
        errEl.textContent = 'Le mot de passe doit faire au moins 6 caractères.';
        errEl.classList.remove('d-none');
        return;
    }

    const btn = document.getElementById('save-admin-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Création…';

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ email, password, full_name: name }),
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

        const modal = bootstrap.Modal.getInstance(document.getElementById('adminModal'));
        if (modal) modal.hide();

        document.getElementById('admin-field-name').value = '';
        document.getElementById('admin-field-email').value = '';
        document.getElementById('admin-field-password').value = '';

        showAlert(`Admin "${name}" créé avec succès.`, 'success');
        loadAdmins();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Créer l\'admin';
    }
});

// Reset form when modal opens
document.getElementById('adminModal')?.addEventListener('show.bs.modal', () => {
    document.getElementById('admin-form-error').classList.add('d-none');
    document.getElementById('admin-field-name').value = '';
    document.getElementById('admin-field-email').value = '';
    document.getElementById('admin-field-password').value = '';
});
