/**
 * Module Avis / Notes par produit
 * Affiche la note moyenne, la liste des avis, et permet d'en poster
 * pour un produit (style Alibaba).
 *
 * Dependances : supabase-config.js, auth.js
 */
import { getSupabase, getUser, showToast, isAdmin } from './auth.js';

const supabase = getSupabase();

const STAR_FULL  = '<i class="bi bi-star-fill"></i>';
const STAR_HALF  = '<i class="bi bi-star-half"></i>';
const STAR_EMPTY = '<i class="bi bi-star"></i>';

const statsCache = new Map();
const REVIEWS_PAGE_SIZE = 20;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function avatarColorFor(id) {
  const colors = ['#0d6efd', '#6f42c1', '#d63384', '#dc3545', '#fd7e14', '#198754', '#20c997', '#0dcaf0'];
  let hash = 0;
  for (let i = 0; i < (id || '').length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Affiche N etoiles pleines + demi + vides, en lecture seule.
 * @param {number} rating 0..5 (accepte decimales)
 * @param {string} size 'sm' | 'md' | 'lg'
 */
export function renderStars(rating, size = 'sm') {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const full  = Math.floor(r);
  const half  = (r - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return `<span class="rv-stars rv-stars-${size}" aria-label="${r.toFixed(1)} sur 5">${STAR_FULL.repeat(full)}${STAR_HALF.repeat(half)}${STAR_EMPTY.repeat(empty)}</span>`;
}

/**
 * Petites etoiles interactives (utilisees dans le formulaire).
 */
function renderInteractiveStars(name, value = 0) {
  let html = `<div class="rv-stars-input" data-name="${esc(name)}" data-value="${value}">`;
  for (let i = 1; i <= 5; i++) {
    const filled = i <= value;
    html += `<button type="button" class="rv-star-btn${filled ? ' active' : ''}" data-value="${i}" aria-label="${i} etoile(s)">
      <i class="bi bi-star${filled ? '-fill' : ''}"></i>
    </button>`;
  }
  html += `<span class="rv-stars-label"></span></div>`;
  return html;
}

function bindInteractiveStars(container) {
  container.querySelectorAll('.rv-stars-input').forEach(group => {
    const label = group.querySelector('.rv-stars-label');
    const update = (val) => {
      group.dataset.value = val;
      group.querySelectorAll('.rv-star-btn').forEach(b => {
        const v = Number(b.dataset.value);
        b.classList.toggle('active', v <= val);
        const i = b.querySelector('i');
        i.className = v <= val ? 'bi bi-star-fill' : 'bi bi-star';
      });
      label.textContent = val ? ['', 'Médiocre', 'Passable', 'Bien', 'Très bien', 'Excellent'][val] : '';
    };
    update(Number(group.dataset.value) || 0);
    group.querySelectorAll('.rv-star-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const v = Number(btn.dataset.value);
        group.querySelectorAll('.rv-star-btn').forEach(b => {
          const i = b.querySelector('i');
          i.className = Number(b.dataset.value) <= v ? 'bi bi-star-fill' : 'bi bi-star';
        });
      });
      btn.addEventListener('click', () => update(Number(btn.dataset.value)));
    });
    group.addEventListener('mouseleave', () => update(Number(group.dataset.value) || 0));
  });
}

/**
 * Charge les stats agregees d'un produit.
 * @returns {Promise<{review_count:number, avg_rating:number, count_5:number, ...} | null>}
 */
export async function getProductStats(productId) {
  if (!productId) return null;
  if (statsCache.has(productId)) return statsCache.get(productId);
  const { data, error } = await supabase
    .from('product_review_stats')
    .select('*')
    .eq('product_id', productId)
    .maybeSingle();
  const stats = error || !data
    ? { review_count: 0, avg_rating: 0, count_5: 0, count_4: 0, count_3: 0, count_2: 0, count_1: 0 }
    : data;
  statsCache.set(productId, stats);
  return stats;
}

export function invalidateStats(productId) {
  if (productId) statsCache.delete(productId);
  else statsCache.clear();
}

/**
 * Charge la liste des avis + profils.
 */
export async function getProductReviews(productId, { limit = REVIEWS_PAGE_SIZE, offset = 0, order = 'recent' } = {}) {
  let q = supabase
    .from('product_reviews')
    .select('id, product_id, user_id, rating, title, comment, helpful_count, created_at, updated_at, profiles!product_reviews_user_id_fkey(full_name)')
    .eq('product_id', productId)
    .range(offset, offset + limit - 1);
  if (order === 'recent') q = q.order('created_at', { ascending: false });
  else if (order === 'oldest') q = q.order('created_at', { ascending: true });
  else if (order === 'highest') q = q.order('rating', { ascending: false }).order('created_at', { ascending: false });
  else if (order === 'lowest') q = q.order('rating', { ascending: true }).order('created_at', { ascending: false });
  else if (order === 'helpful') q = q.order('helpful_count', { ascending: false }).order('created_at', { ascending: false });

  const { data, error } = await q;
  if (error) { console.error('getProductReviews', error); return []; }
  return data || [];
}

/**
 * Verifie si l'utilisateur connecte a deja poste un avis.
 */
export async function getUserReviewForProduct(productId) {
  const user = getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('product_reviews')
    .select('*')
    .eq('product_id', productId)
    .eq('user_id', user.id)
    .maybeSingle();
  return data;
}

/**
 * Chip compact (note + nombre) affiche sur la card produit.
 */
export function renderRatingChip(stats) {
  if (!stats || !stats.review_count) {
    return `<span class="rv-chip rv-chip-empty" title="Pas encore d'avis">
      <i class="bi bi-star"></i><span class="rv-chip-text">Aucun avis</span>
    </span>`;
  }
  const avg = Number(stats.avg_rating).toFixed(1);
  return `<span class="rv-chip" title="${avg}/5 sur ${stats.review_count} avis">
      ${renderStars(stats.avg_rating, 'sm')}
      <span class="rv-chip-avg">${avg}</span>
      <span class="rv-chip-count">(${stats.review_count})</span>
    </span>`;
}

function renderRatingBars(stats) {
  const total = stats.review_count || 0;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  const bar = (n) => `
    <div class="rv-bar-row">
      <span class="rv-bar-label">${n} <i class="bi bi-star-fill"></i></span>
      <div class="rv-bar-track"><div class="rv-bar-fill" style="width:${pct(n)}%"></div></div>
      <span class="rv-bar-count">${stats['count_' + n] || 0}</span>
    </div>`;
  return `<div class="rv-bars">${[5, 4, 3, 2, 1].map(bar).join('')}</div>`;
}

function renderReviewItem(r) {
  const name = r.profiles?.full_name || 'Utilisateur';
  const initials = getInitials(name);
  const color = avatarColorFor(r.user_id);
  const date = formatDate(r.created_at);
  const edited = r.updated_at && r.updated_at !== r.created_at
    ? `<span class="rv-edited">(modifié le ${formatDate(r.updated_at)})</span>` : '';
  return `
    <div class="rv-item" data-review-id="${esc(r.id)}">
      <div class="rv-avatar" style="background:${color}">${esc(initials)}</div>
      <div class="rv-body">
        <div class="rv-head">
          <strong class="rv-author">${esc(name)}</strong>
          <span class="rv-date">${date} ${edited}</span>
        </div>
        <div class="rv-rating">${renderStars(r.rating, 'sm')}</div>
        ${r.title ? `<div class="rv-title">${esc(r.title)}</div>` : ''}
        ${r.comment ? `<p class="rv-comment">${esc(r.comment).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
    </div>`;
}

/**
 * Construit le HTML complet de la section avis (stats + liste + bouton "ecrire").
 */
export function buildReviewsSectionHTML(productId) {
  return `
    <div class="rv-section" data-product-id="${esc(productId)}">
      <div class="rv-summary">
        <div class="rv-summary-head">
          <h3 class="rv-summary-title"><i class="bi bi-star-half me-2"></i>Avis des clients</h3>
        </div>
        <div class="rv-summary-grid">
          <div class="rv-summary-avg">
            <div class="rv-avg-number">—</div>
            ${renderStars(0, 'md')}
            <div class="rv-avg-label">Aucun avis pour le moment</div>
          </div>
          <div class="rv-summary-bars">
            ${renderRatingBars({ review_count: 0, count_1: 0, count_2: 0, count_3: 0, count_4: 0, count_5: 0 })}
          </div>
        </div>
        <div class="rv-actions">
          <button type="button" class="btn btn-primary btn-sm rv-write-btn">
            <i class="bi bi-pencil-square me-1"></i>Écrire un avis
          </button>
          <span class="rv-user-hint text-muted small"></span>
        </div>
      </div>

      <div class="rv-toolbar">
        <div class="rv-toolbar-label">Filtrer par note :</div>
        <div class="rv-filter-group">
          <button class="rv-filter-btn active" data-filter="all">Tous</button>
          <button class="rv-filter-btn" data-filter="5">5 <i class="bi bi-star-fill"></i></button>
          <button class="rv-filter-btn" data-filter="4">4 <i class="bi bi-star-fill"></i></button>
          <button class="rv-filter-btn" data-filter="3">3 <i class="bi bi-star-fill"></i></button>
          <button class="rv-filter-btn" data-filter="2">2 <i class="bi bi-star-fill"></i></button>
          <button class="rv-filter-btn" data-filter="1">1 <i class="bi bi-star-fill"></i></button>
        </div>
        <div class="rv-sort ms-auto">
          <select class="form-select form-select-sm rv-sort-select">
            <option value="recent">Plus récents</option>
            <option value="oldest">Plus anciens</option>
            <option value="highest">Mieux notés</option>
            <option value="lowest">Moins bien notés</option>
            <option value="helpful">Plus utiles</option>
          </select>
        </div>
      </div>

      <div class="rv-list"></div>
    </div>`;
}

/**
 * Rend la section avis d'un produit a l'interieur d'un conteneur.
 */
export async function renderReviewsSection(container, productId) {
  if (!container) return;
  container.innerHTML = buildReviewsSectionHTML(productId);
  await refreshReviewsSection(container, productId);
}

async function refreshReviewsSection(container, productId) {
  const stats = await getProductStats(productId);
  paintSummary(container, stats);
  paintUserHint(container);

  let order = container.querySelector('.rv-sort-select')?.value || 'recent';
  let ratingFilter = container.querySelector('.rv-filter-btn.active')?.dataset.filter || 'all';

  const allReviews = await getProductReviews(productId, { limit: 200, order });
  const filtered = ratingFilter === 'all'
    ? allReviews
    : allReviews.filter(r => Number(r.rating) === Number(ratingFilter));

  paintList(container, filtered, stats);
  bindSectionEvents(container, productId);
}

function paintSummary(container, stats) {
  const avgEl = container.querySelector('.rv-avg-number');
  const avgStars = container.querySelector('.rv-summary-avg .rv-stars');
  const labelEl = container.querySelector('.rv-avg-label');
  const barsEl = container.querySelector('.rv-summary-bars');

  if (!stats || !stats.review_count) {
    avgEl.textContent = '—';
    if (avgStars) avgStars.outerHTML = renderStars(0, 'md');
    labelEl.textContent = 'Aucun avis pour le moment';
    barsEl.innerHTML = renderRatingBars({ review_count: 0, count_1: 0, count_2: 0, count_3: 0, count_4: 0, count_5: 0 });
    return;
  }
  const avg = Number(stats.avg_rating);
  avgEl.textContent = avg.toFixed(1);
  if (avgStars) avgStars.outerHTML = renderStars(avg, 'md');
  labelEl.textContent = `Basé sur ${stats.review_count} avis`;
  barsEl.innerHTML = renderRatingBars(stats);
}

async function paintUserHint(container) {
  const hint = container.querySelector('.rv-user-hint');
  const writeBtn = container.querySelector('.rv-write-btn');
  if (!hint || !writeBtn) return;
  const user = getUser();
  if (!user) {
    hint.innerHTML = '<i class="bi bi-info-circle me-1"></i>Connectez-vous pour poster un avis';
    writeBtn.onclick = () => {
      const m = document.getElementById('authModal');
      if (m) new bootstrap.Modal(m).show();
    };
  } else {
    hint.innerHTML = '<i class="bi bi-person-check me-1"></i>Partagez votre expérience';
    writeBtn.onclick = () => openReviewForm(container.dataset.productId);
  }
}

function paintList(container, reviews, stats) {
  const listEl = container.querySelector('.rv-list');
  if (!listEl) return;
  if (!reviews.length) {
    listEl.innerHTML = `<div class="rv-empty">
      <i class="bi bi-chat-square-dots"></i>
      <p>Aucun avis ne correspond à votre filtre.</p>
    </div>`;
    return;
  }
  listEl.innerHTML = reviews.map(renderReviewItem).join('') +
    `<div class="rv-count-footer">${reviews.length} avis affiché(s) sur ${stats?.review_count || reviews.length}</div>`;
}

function bindSectionEvents(container, productId) {
  container.querySelectorAll('.rv-filter-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.rv-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshReviewsSection(container, productId);
    };
  });
  const sortSel = container.querySelector('.rv-sort-select');
  if (sortSel) sortSel.onchange = () => refreshReviewsSection(container, productId);
}

/**
 * Ouvre le formulaire d'avis (creation ou edition) en modale Bootstrap.
 */
async function openReviewForm(productId, existing = null) {
  const user = getUser();
  if (!user) {
    new bootstrap.Modal(document.getElementById('authModal')).show();
    return;
  }
  if (!existing) existing = await getUserReviewForProduct(productId);

  const isEdit = !!existing;
  let modal = document.getElementById('rv-form-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'rv-form-modal';
  modal.innerHTML = `
    <div class="modal fade" id="rv-form-modal-inner" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content" style="border-radius:16px;border:none;">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title fw-bold">
              <i class="bi bi-star-half me-2"></i>${isEdit ? 'Modifier votre avis' : 'Écrire un avis'}
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body pt-2">
            <div id="rv-form-error" class="alert alert-danger d-none small"></div>
            <div class="mb-3">
              <label class="form-label small fw-semibold text-secondary">Votre note <span class="text-danger">*</span></label>
              ${renderInteractiveStars('rating', existing?.rating || 0)}
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold text-secondary">Titre (optionnel)</label>
              <input type="text" class="form-control" id="rv-form-title" maxlength="80"
                placeholder="Résumez votre avis en une phrase" value="${esc(existing?.title || '')}">
            </div>
            <div class="mb-2">
              <label class="form-label small fw-semibold text-secondary">Commentaire (optionnel)</label>
              <textarea class="form-control" id="rv-form-comment" rows="4" maxlength="1000"
                placeholder="Partagez votre expérience avec ce produit…">${esc(existing?.comment || '')}</textarea>
            </div>
            <small class="text-muted"><i class="bi bi-shield-check me-1"></i>Votre avis est public et contribuera à aider d'autres acheteurs.</small>
          </div>
          <div class="modal-footer border-0 pt-0">
            ${isEdit ? `<button type="button" class="btn btn-outline-danger me-auto" id="rv-form-delete">
              <i class="bi bi-trash me-1"></i>Supprimer
            </button>` : ''}
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
            <button type="button" class="btn btn-primary fw-bold" id="rv-form-save">
              <i class="bi bi-check2 me-1"></i>${isEdit ? 'Mettre à jour' : 'Publier'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  bindInteractiveStars(modal);
  const bsModal = new bootstrap.Modal(modal.querySelector('.modal'));
  bsModal.show();
  modal.querySelector('.modal').addEventListener('hidden.bs.modal', () => modal.remove());

  modal.querySelector('#rv-form-save').addEventListener('click', async () => {
    const errEl = modal.querySelector('#rv-form-error');
    errEl.classList.add('d-none');
    const rating = Number(modal.querySelector('[data-name="rating"]').dataset.value);
    if (!rating) {
      errEl.textContent = 'Veuillez sélectionner une note.';
      errEl.classList.remove('d-none');
      return;
    }
    const title   = modal.querySelector('#rv-form-title').value.trim() || null;
    const comment = modal.querySelector('#rv-form-comment').value.trim() || null;
    const btn = modal.querySelector('#rv-form-save');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Envoi…';
    try {
      const payload = { product_id: productId, user_id: user.id, rating, title, comment };
      let res;
      if (isEdit) {
        res = await supabase.from('product_reviews').update({ rating, title, comment }).eq('id', existing.id);
      } else {
        res = await supabase.from('product_reviews').insert(payload);
      }
      if (res.error) {
        if (res.error.code === '23505') throw new Error('Vous avez déjà posté un avis pour ce produit.');
        throw res.error;
      }
      invalidateStats(productId);
      showToast(isEdit ? 'Avis mis à jour.' : 'Merci pour votre avis !', 'success');
      bsModal.hide();
      const container = document.querySelector(`.rv-section[data-product-id="${CSS.escape(productId)}"]`);
      if (container) await refreshReviewsSection(container, productId);
      document.dispatchEvent(new CustomEvent('reviews:changed', { detail: { productId } }));
    } catch (e) {
      errEl.textContent = e.message || 'Erreur lors de l\'envoi.';
      errEl.classList.remove('d-none');
      btn.disabled = false;
      btn.innerHTML = `<i class="bi bi-check2 me-1"></i>${isEdit ? 'Mettre à jour' : 'Publier'}`;
    }
  });

  const delBtn = modal.querySelector('#rv-form-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement votre avis ?')) return;
      delBtn.disabled = true;
      delBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Suppression…';
      const { error } = await supabase.from('product_reviews').delete().eq('id', existing.id);
      if (error) { showToast('Erreur : ' + error.message, 'error'); delBtn.disabled = false; delBtn.innerHTML = '<i class="bi bi-trash me-1"></i>Supprimer'; return; }
      invalidateStats(productId);
      showToast('Avis supprimé.', 'success');
      bsModal.hide();
      const container = document.querySelector(`.rv-section[data-product-id="${CSS.escape(productId)}"]`);
      if (container) await refreshReviewsSection(container, productId);
      document.dispatchEvent(new CustomEvent('reviews:changed', { detail: { productId } }));
    });
  }
}

/**
 * Injecte la note moyenne sur toutes les cards produits affichees.
 * A appeler apres le rendu du catalogue.
 */
export async function paintCardsRating() {
  const cards = document.querySelectorAll('.product-card[data-product-id]');
  if (!cards.length) return;
  await Promise.all([...cards].map(async (card) => {
    const id = card.dataset.productId;
    const slot = card.querySelector('.rv-card-slot');
    if (!slot) return;
    const stats = await getProductStats(id);
    slot.innerHTML = renderRatingChip(stats);
  }));
  document.dispatchEvent(new CustomEvent('reviews:catalog-painted'));
}

export { openReviewForm };
