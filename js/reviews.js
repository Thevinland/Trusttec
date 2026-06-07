/**
 * Module Avis / Notes par produit
 * Affiche la note moyenne, la liste des avis, et permet d'en poster
 * pour un produit (style Alibaba).
 *
 * Dependances : supabase-config.js, auth.js
 */
import { getSupabase, getUser, showToast } from './auth.js';

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
        b.setAttribute('aria-checked', String(v === val));
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

    // Group : role radiogroup accessible au clavier
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Note sur 5');
    group.querySelectorAll('.rv-star-btn').forEach(b => {
      b.setAttribute('role', 'radio');
      b.setAttribute('tabindex', b === group.querySelector('.rv-star-btn') ? '0' : '-1');
    });
    // Roving tabindex : au focus du groupe, on place le focus sur l'etoile correspondant
    // a la valeur courante (ou la derniere si pas de valeur).
    const focusBtn = (v) => {
      const target = group.querySelector(`.rv-star-btn[data-value="${v}"]`)
        || group.querySelector('.rv-star-btn');
      group.querySelectorAll('.rv-star-btn').forEach(b => b.setAttribute('tabindex', '-1'));
      target.setAttribute('tabindex', '0');
      target.focus();
    };
    group.addEventListener('keydown', (e) => {
      const current = Number(group.dataset.value) || 0;
      // Chiffres 1..5 = note directe
      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        update(Number(e.key));
        const target = group.querySelector(`.rv-star-btn[data-value="${e.key}"]`);
        if (target) {
          group.querySelectorAll('.rv-star-btn').forEach(b => b.setAttribute('tabindex', '-1'));
          target.setAttribute('tabindex', '0');
        }
        return;
      }
      // Fleches gauche/droite pour ajuster
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(5, (current || 0) + 1);
        update(next); focusBtn(next);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(1, (current || 1) - 1);
        update(next); focusBtn(next);
      } else if (e.key === 'Home') {
        e.preventDefault(); update(1); focusBtn(1);
      } else if (e.key === 'End') {
        e.preventDefault(); update(5); focusBtn(5);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const active = document.activeElement;
        if (active && active.classList.contains('rv-star-btn')) {
          update(Number(active.dataset.value));
        }
      }
    });
  });
}

/**
 * Charge les stats agregees d'un produit.
 * @returns {Promise<{review_count:number, avg_rating:number, count_5:number, ...} | null>}
 */
export async function getProductStats(productId) {
  if (!productId) return null;
  if (statsCache.has(productId)) return statsCache.get(productId);
  const all = await getAllProductStats([productId]);
  return all.get(productId) || emptyStats();
}

function emptyStats() {
  return { review_count: 0, avg_rating: 0, count_5: 0, count_4: 0, count_3: 0, count_2: 0, count_1: 0 };
}

/**
 * Charge les stats de PLUSIEURS produits en UNE seule requete.
 * - Evite le pattern N+1 (1 query / produit)
 * - Renvoie une Map<productId, stats>
 * - Les produits sans avis renvoient un objet vide
 */
export async function getAllProductStats(productIds) {
  const ids = (productIds || []).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;

  // Verifier le cache d'abord
  const toFetch = ids.filter(id => !statsCache.has(id));
  if (toFetch.length) {
    const { data, error } = await supabase
      .from('product_review_stats')
      .select('*')
      .in('product_id', toFetch);
    if (!error) {
      (data || []).forEach(s => statsCache.set(s.product_id, s));
    }
  }

  ids.forEach(id => {
    if (!statsCache.has(id)) statsCache.set(id, emptyStats());
    map.set(id, statsCache.get(id));
  });
  return map;
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
    .select('id, product_id, user_id, rating, title, comment, helpful_count, created_at, updated_at, admin_reply, admin_reply_at, reviewer:reviewer_names!product_reviews_user_id_fkey(full_name), admin:admin_replier_names!product_reviews_admin_reply_by_fkey(full_name)')
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

function renderReviewItem(r, { voted = false, canVote = true } = {}) {
  const name = r.reviewer?.full_name || 'Utilisateur';
  const initials = getInitials(name);
  const color = avatarColorFor(r.user_id);
  const date = formatDate(r.created_at);
  const edited = r.updated_at && r.updated_at !== r.created_at
    ? `<span class="rv-edited">(modifié le ${formatDate(r.updated_at)})</span>` : '';
  const helpfulDisabled = !canVote;
  const adminReplyHtml = r.admin_reply ? renderAdminReply(r) : '';
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
        ${adminReplyHtml}
        <div class="rv-actions-row">
          <button class="rv-helpful-btn${voted ? ' voted' : ''}${helpfulDisabled ? ' disabled' : ''}"
                  data-id="${esc(r.id)}" type="button"
                  ${helpfulDisabled ? 'disabled aria-disabled="true"' : ''}
                  title="${voted ? 'Vous avez trouvé cet avis utile' : 'Marquer comme utile'}">
            <i class="bi bi-hand-thumbs-up${voted ? '-fill' : ''}"></i>
            <span>Utile</span>
            <span class="rv-helpful-count">${r.helpful_count || 0}</span>
          </button>
          <div class="dropdown rv-report-menu">
            <button class="rv-report-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false"
                    title="Plus d'options" aria-label="Plus d'options">
              <i class="bi bi-three-dots"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button class="dropdown-item rv-report-btn" type="button" data-id="${esc(r.id)}" data-reason="spam">
                <i class="bi bi-megaphone me-2"></i>Signaler comme spam</button></li>
              <li><button class="dropdown-item rv-report-btn" type="button" data-id="${esc(r.id)}" data-reason="abuse">
                <i class="bi bi-shield-exclamation me-2"></i>Contenu abusif</button></li>
              <li><button class="dropdown-item rv-report-btn" type="button" data-id="${esc(r.id)}" data-reason="fake">
                <i class="bi bi-question-circle me-2"></i>Avis faux / trompeur</button></li>
              <li><button class="dropdown-item rv-report-btn" type="button" data-id="${esc(r.id)}" data-reason="other">
                <i class="bi bi-chat-square me-2"></i>Autre motif</button></li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
}

function renderAdminReply(r) {
  const adminName = r.admin?.full_name || 'Trusttec';
  const replyDate = formatDate(r.admin_reply_at);
  return `
    <div class="rv-admin-reply">
      <div class="rv-admin-reply-head">
        <span class="rv-admin-reply-badge"><i class="bi bi-patch-check-fill me-1"></i>Réponse officielle</span>
        <span class="rv-admin-reply-author">${esc(adminName)}</span>
        <span class="rv-admin-reply-date">${replyDate}</span>
      </div>
      <p class="rv-admin-reply-text">${esc(r.admin_reply).replace(/\n/g, '<br>')}</p>
    </div>`;
}

/**
 * Renvoie l'ensemble des review_id que l'utilisateur a votes
 * (1 seule requete pour toute la liste -> pas de N+1)
 */
async function getUserVotedReviewIds(reviewIds) {
  const user = getUser();
  if (!user || !reviewIds?.length) return new Set();
  const { data } = await supabase
    .from('review_votes')
    .select('review_id')
    .eq('user_id', user.id)
    .in('review_id', reviewIds);
  return new Set((data || []).map(v => v.review_id));
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

  const order = container.querySelector('.rv-sort-select')?.value || 'recent';
  const ratingFilter = container.querySelector('.rv-filter-btn.active')?.dataset.filter || 'all';

  const allReviews = await getProductReviews(productId, { limit: 200, order });
  // 1 requete pour les votes du user sur tous ces avis
  const votes = await getUserVotedReviewIds(allReviews.map(r => r.id));

  const filtered = ratingFilter === 'all'
    ? allReviews
    : allReviews.filter(r => Number(r.rating) === Number(ratingFilter));

  paintList(container, filtered, stats, votes, productId);
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

function paintList(container, reviews, stats, votedSet, productId) {
  const listEl = container.querySelector('.rv-list');
  if (!listEl) return;
  if (!reviews.length) {
    listEl.innerHTML = `<div class="rv-empty">
      <i class="bi bi-chat-square-dots"></i>
      <p>Aucun avis ne correspond à votre filtre.</p>
    </div>`;
    return;
  }
  const isAuthed = !!getUser();
  const total = stats?.review_count || reviews.length;
  const footer = reviews.length === total
    ? `${total} ${total > 1 ? 'avis' : 'avis'}`
    : `Affichage de ${reviews.length} sur ${total} avis`;
  listEl.innerHTML = reviews.map(r => renderReviewItem(r, { voted: votedSet.has(r.id), canVote: isAuthed })).join('') +
    `<div class="rv-count-footer">${footer}</div>`;
  bindItemEvents(listEl, productId);
}

function bindItemEvents(listEl, productId) {
  listEl.querySelectorAll('.rv-helpful-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      if (!getUser()) {
        const m = document.getElementById('authModal');
        if (m) new bootstrap.Modal(m).show();
        return;
      }
      const reviewId = btn.dataset.id;
      btn.disabled = true;
      const { data, error } = await supabase.rpc('toggle_review_helpful', { p_review_id: reviewId });
      btn.disabled = false;
      if (error || !data || !data.length) {
        showToast('Impossible d\'enregistrer votre vote.', 'error');
        return;
      }
      const { helpful_count, voted } = data[0];
      btn.classList.toggle('voted', voted);
      const icon = btn.querySelector('i');
      icon.className = voted ? 'bi bi-hand-thumbs-up-fill' : 'bi bi-hand-thumbs-up';
      btn.querySelector('.rv-helpful-count').textContent = helpful_count;
    });
  });

  listEl.querySelectorAll('.rv-report-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const reviewId = btn.dataset.id;
      const reason = btn.dataset.reason;
      if (!getUser()) {
        const m = document.getElementById('authModal');
        if (m) new bootstrap.Modal(m).show();
        return;
      }
      const { data, error } = await supabase.rpc('report_review', {
        p_review_id: reviewId,
        p_reason: reason,
        p_details: null
      });
      if (error) { showToast('Erreur : ' + error.message, 'error'); return; }
      if (data === false) {
        showToast('Vous avez déjà signalé cet avis.', 'info');
      } else {
        showToast('Signalement envoyé. Merci !', 'success');
      }
      // Fermer le dropdown
      const dd = bootstrap.Dropdown.getInstance(btn.closest('.dropdown').querySelector('.rv-report-toggle'));
      if (dd) dd.hide();
    });
  });
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
  const EDIT_WINDOW_DAYS = 30;
  const createdDate = existing ? new Date(existing.created_at) : null;
  const editExpired = isEdit && createdDate && (Date.now() - createdDate.getTime() > EDIT_WINDOW_DAYS * 86400 * 1000);

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
              <i class="bi bi-star-half me-2"></i>${isEdit ? 'Votre avis' : 'Écrire un avis'}
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body pt-2">
            <div id="rv-form-error" class="alert alert-danger d-none small"></div>
            ${editExpired ? `<div class="alert alert-warning small">
              <i class="bi bi-info-circle me-1"></i>La fenêtre d'édition de ${EDIT_WINDOW_DAYS} jours est dépassée. Vous pouvez toujours le supprimer.
            </div>` : ''}
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
            <button type="button" class="btn btn-primary fw-bold" id="rv-form-save" ${editExpired ? 'disabled' : ''}>
              <i class="bi bi-check2 me-1"></i>${isEdit ? 'Mettre à jour' : 'Publier'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  bindInteractiveStars(modal);

  // Si fenetre d'edition depassee, on bloque les inputs
  if (editExpired) {
    modal.querySelectorAll('.rv-star-btn, #rv-form-title, #rv-form-comment').forEach(el => {
      el.setAttribute('disabled', 'true');
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.6';
    });
  }

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
      // RPC atomique : insert/update + verif anti-spam + edit-window
      const { error } = await supabase.rpc('submit_review', {
        p_product_id: productId,
        p_rating: rating,
        p_title: title,
        p_comment: comment
      });
      if (error) throw error;
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
      const { error } = await supabase.rpc('delete_my_review', { p_review_id: existing.id });
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
 * 1 seule requete pour toutes les cards (evite le N+1).
 * A appeler apres le rendu du catalogue.
 */
export async function paintCardsRating() {
  const cards = document.querySelectorAll('.product-card[data-product-id]');
  if (!cards.length) return;
  const ids = [...cards].map(c => c.dataset.productId);
  const statsMap = await getAllProductStats(ids);
  cards.forEach(card => {
    const slot = card.querySelector('.rv-card-slot');
    if (!slot) return;
    slot.innerHTML = renderRatingChip(statsMap.get(card.dataset.productId));
  });
  document.dispatchEvent(new CustomEvent('reviews:catalog-painted'));
}

export { openReviewForm };
