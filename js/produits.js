import { initApp } from './init.js';
import { getSupabase, isAdmin } from './auth.js';

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.getElementById('current-year').textContent = new Date().getFullYear();

initApp();

const supabase = getSupabase();

let qvProduct = null;
let qvVariantsState = [];
let allCategories = [];
let allProductsData = [];
let activeCategory = 'all';
let searchQuery = '';

const qvModal = new bootstrap.Modal(document.getElementById('quickViewModal'));

async function loadProducts() {
    const loadingEl = document.getElementById('loading-state');
    const errorEl = document.getElementById('error-state');

    try {
        const [catRes, prodRes] = await Promise.all([
            supabase.from('categories').select('*').order('sort_order'),
            supabase.from('products').select('*').eq('active', true).order('sort_order')
        ]);
        if (catRes.error) throw catRes.error;
        if (prodRes.error) throw prodRes.error;

        loadingEl.style.display = 'none';
        allCategories = catRes.data || [];
        allProductsData = prodRes.data || [];
        window._allProducts = allProductsData;

        buildFilterButtons();
        filterAndRender();

        const params = new URLSearchParams(window.location.search);
        const qvId = params.get('quickview');
        if (qvId) {
            setTimeout(() => {
                openQV(qvId);
                history.replaceState(null, '', window.location.pathname);
            }, 300);
        }

        const hash = window.location.hash.replace('#', '');
        if (hash && !qvId) {
            setTimeout(() => {
                const el = document.getElementById(hash);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 400);
        }

    } catch (err) {
        console.error('Erreur Supabase :', err);
        loadingEl.style.display = 'none';
        errorEl.classList.remove('d-none');
    }
}

function buildFilterButtons() {
    const wrap = document.getElementById('category-filters');
    wrap.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'filter-btn active';
    allBtn.dataset.cat = 'all';
    allBtn.textContent = 'Tout';
    wrap.appendChild(allBtn);

    allCategories.forEach(cat => {
        const hasProducts = allProductsData.some(p => p.category === cat.id);
        if (!hasProducts) return;

        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.cat = cat.id;
        btn.textContent = cat.label;
        wrap.appendChild(btn);
    });

    wrap.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeCategory = btn.dataset.cat;
            wrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterAndRender();
        });
    });
}

function filterAndRender() {
    let filtered = allProductsData;

    if (activeCategory !== 'all') {
        filtered = filtered.filter(p => p.category === activeCategory);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.description && p.description.toLowerCase().includes(q))
        );
    }

    const bar = document.getElementById('search-results-bar');
    const barText = document.getElementById('search-results-text');
    if (q || activeCategory !== 'all') {
        bar.classList.add('visible');
        const catLabel = activeCategory !== 'all'
            ? allCategories.find(c => c.id === activeCategory)?.label
            : null;
        let msg = `${filtered.length} résultat(s)`;
        if (q) msg += ` pour "<strong>${escHtml(q)}</strong>"`;
        if (catLabel) msg += ` dans <strong>${escHtml(catLabel)}</strong>`;
        barText.innerHTML = msg;
    } else {
        bar.classList.remove('visible');
    }

    renderProducts(filtered);
}

function renderProducts(products) {
    const container = document.getElementById('products-container');
    container.innerHTML = '';

    if (!products.length) {
        container.innerHTML = `
            <div class="empty-search">
                <div class="empty-icon"><i class="bi bi-search"></i></div>
                <h5>Aucun produit trouvé</h5>
                <p>Essayez un autre mot-clé ou explorez toutes les catégories.</p>
                <button class="btn btn-outline-primary mt-2" id="empty-reset-btn">
                    <i class="bi bi-arrow-repeat me-1"></i>Voir tous les produits
                </button>
            </div>`;
        document.getElementById('empty-reset-btn')?.addEventListener('click', resetFilters);
        return;
    }

    if (activeCategory !== 'all' || searchQuery.trim()) {
        const grid = document.createElement('div');
        grid.className = 'row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-4 mb-5';
        grid.innerHTML = products.map(p => buildCard(p)).join('');
        container.appendChild(grid);
    } else {
        allCategories.forEach(cat => {
            const catProds = products.filter(p => p.category === cat.id);
            if (!catProds.length) return;
            const section = document.createElement('section');
            section.id = cat.id;
            section.className = 'mb-5';
            section.innerHTML = `
                <h2 class="mb-4 fw-bold border-bottom pb-2" style="color:#0d1b4b;">${escHtml(cat.label)}</h2>
                <div class="row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-4">
                    ${catProds.map(p => buildCard(p)).join('')}
                </div>`;
            container.appendChild(section);
        });
    }

    bindCardEvents();
}

function resetFilters() {
    searchQuery = '';
    activeCategory = 'all';
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').style.display = 'none';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-cat="all"]')?.classList.add('active');
    filterAndRender();
}

document.getElementById('search-input').addEventListener('input', function () {
    searchQuery = this.value;
    document.getElementById('search-clear').style.display = searchQuery ? 'block' : 'none';
    filterAndRender();
});

document.getElementById('search-clear').addEventListener('click', () => {
    searchQuery = '';
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').style.display = 'none';
    filterAndRender();
});

document.getElementById('search-reset-btn').addEventListener('click', resetFilters);

function buildCard(p) {
    const price = Number(p.price).toLocaleString('fr-FR');
    const colors = safeJSON(p.colors);
    const firstColor = colors.length > 0 ? colors[0] : null;

    let swatchesHTML = '';
    let colorNameHTML = '';
    if (colors.length > 0) {
        swatchesHTML = `<div class="color-swatches-mini">
            ${colors.slice(0, 7).map((c, i) =>
            `<div class="swatch-mini${i === 0 ? ' selected' : ''}"
                      style="background:${esc(c.hex)}"
                      title="${esc(c.name)}"
                      data-color="${esc(c.name)}"
                      data-hex="${esc(c.hex)}"></div>`
        ).join('')}
            ${colors.length > 7 ? `<span class="swatch-more">+${colors.length - 7}</span>` : ''}
        </div>`;
        colorNameHTML = `<div class="selected-color-name" id="cn-${esc(p.id)}">
            <span class="dot" id="cn-dot-${esc(p.id)}" style="background:${esc(colors[0].hex)};"></span>
            <span id="cn-label-${esc(p.id)}">${esc(colors[0].name)}</span>
        </div>`;
    }

    return `
    <div class="col">
      <div class="card product-card h-100">
        <div class="product-image-wrapper">
          <img src="${esc(p.image_url)}" class="product-image" loading="lazy" alt="${esc(p.name)}"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'300\' height=\'230\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'%23dce3f0\'/%3E%3C/svg%3E'">
          <div class="product-overlay">
            <button class="btn-quick-view btn-open-qv" data-id="${esc(p.id)}">
              <i class="bi bi-eye me-1"></i> Vue rapide
            </button>
          </div>
        </div>
        <div class="card-body d-flex flex-column">
          <h5 class="card-title">${esc(p.name)}</h5>
          ${swatchesHTML}
          ${colorNameHTML}
          <p class="card-text description flex-grow-1">${esc(p.description)}</p>
          <div class="product-price mt-auto">${price} <small>XAF</small></div>
          <div class="card-actions">
            <button class="btn-add-cart-card add-to-cart-btn"
                    data-id="${esc(p.id)}"
                    data-name="${esc(p.name)}"
                    data-price="${p.price}"
                    data-img="${esc(p.image_url)}"
                    data-card-id="${esc(p.id)}"
                    data-color-name="${firstColor ? esc(firstColor.name) : ''}"
                    data-color-hex="${firstColor ? esc(firstColor.hex) : ''}">
              <i class="bi bi-cart-plus me-1"></i> Ajouter
            </button>
            <button class="btn-see-details btn-open-qv" data-id="${esc(p.id)}" title="Voir les détails">
              <i class="bi bi-arrows-fullscreen"></i>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function bindCardEvents() {
    document.querySelectorAll('.color-swatches-mini').forEach(wrap => {
        wrap.querySelectorAll('.swatch-mini').forEach(s => {
            s.addEventListener('click', () => {
                wrap.querySelectorAll('.swatch-mini').forEach(x => x.classList.remove('selected'));
                s.classList.add('selected');
                const card = s.closest('.product-card');
                if (!card) return;
                const addBtn = card.querySelector('.btn-add-cart-card');
                const productId = addBtn ? addBtn.dataset.cardId : null;
                const dotEl = productId ? document.getElementById('cn-dot-' + productId) : null;
                const labelEl = productId ? document.getElementById('cn-label-' + productId) : null;
                if (dotEl) dotEl.style.background = s.dataset.hex;
                if (labelEl) labelEl.textContent = s.dataset.color;
                if (addBtn) {
                    addBtn.dataset.colorName = s.dataset.color;
                    addBtn.dataset.colorHex = s.dataset.hex;
                }
            });
        });
    });

    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Ajouté !';
            btn.style.background = '#198754';
            setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 1500);
        });
    });

    document.querySelectorAll('.btn-open-qv').forEach(btn => {
        btn.addEventListener('click', () => openQV(btn.dataset.id));
    });
}

function openQV(productId) {
    const p = (window._allProducts || []).find(x => x.id === productId);
    if (!p) return;
    resetQVChat();
    document.getElementById('qv-chat-panel').style.display = 'none';
    document.getElementById('qv-details').style.display = 'block';
    qvProduct = p;

    document.getElementById('qv-img').src = p.image_url;
    document.getElementById('qv-ref').textContent = `Réf : ${p.id}`;
    document.getElementById('qv-name').textContent = p.name;
    document.getElementById('qv-price').innerHTML = `${Number(p.price).toLocaleString('fr-FR')} <small>XAF</small>`;
    document.getElementById('qv-desc').textContent = p.description;

    const shareBtn = document.getElementById('qv-share-btn');
    shareBtn.className = 'btn-share';
    shareBtn.innerHTML = '<i class="bi bi-share"></i><span class="d-none d-sm-inline">Partager</span>';

    const colors = safeJSON(p.colors);
    initColorSwatcher(colors, p.image_url);

    const listEl = document.getElementById('qv-variants-list');
    const labelEl = document.getElementById('qv-variants-label');
    qvVariantsState = [];
    listEl.innerHTML = '';

    if (colors.length > 0) {
        labelEl.textContent = "Couleurs disponibles :";
        colors.forEach((c, index) => {
            qvVariantsState.push({ colorName: c.name, colorHex: c.hex, qty: 0 });
            listEl.innerHTML += `
                <div class="d-flex align-items-center justify-content-between mb-2 p-2 rounded" style="background:#f8f9fa; border:1px solid #e9ecef;">
                    <div class="d-flex align-items-center gap-2">
                        <span style="width:20px;height:20px;border-radius:50%;background:${esc(c.hex)};border:1px solid rgba(0,0,0,0.15);flex-shrink:0;"></span>
                        <span class="fw-bold text-dark" style="font-size:0.85rem">${esc(c.name)}</span>
                    </div>
                    <div class="qty-wrap m-0" style="height:32px;">
                        <button class="qty-btn" data-index="${index}" data-delta="-1" style="width:32px;height:32px;line-height:1;">−</button>
                        <span class="qty-num" id="var-qty-${index}" style="width:36px;height:32px;line-height:30px;">0</span>
                        <button class="qty-btn" data-index="${index}" data-delta="1" style="width:32px;height:32px;line-height:1;">+</button>
                    </div>
                </div>`;
        });
    } else {
        labelEl.textContent = "Quantité :";
        qvVariantsState.push({ colorName: '', colorHex: '', qty: 1 });
        listEl.innerHTML = `
            <div class="qty-wrap mb-0">
                <button class="qty-btn" data-index="0" data-delta="-1">−</button>
                <span class="qty-num" id="var-qty-0">1</span>
                <button class="qty-btn" data-index="0" data-delta="1">+</button>
            </div>`;
    }

    const specs = safeJSON(p.specs);
    const specsWrap = document.getElementById('qv-specs-wrap');
    const specsGrid = document.getElementById('qv-specs-grid');
    if (specs.length > 0) {
        specsWrap.style.display = 'block';
        specsGrid.innerHTML = specs.map(s =>
            `<div class="spec-row">
                <div class="spec-key">${esc(s.key)}</div>
                <div class="spec-val">${esc(s.value)}</div>
            </div>`
        ).join('');
    } else {
        specsWrap.style.display = 'none';
    }

    refreshQVChatButton();
    qvModal.show();
}

document.getElementById('qv-share-btn').addEventListener('click', () => {
    if (!qvProduct) return;

    const url = `${window.location.origin}${window.location.pathname}?quickview=${qvProduct.id}`;
    const shareBtn = document.getElementById('qv-share-btn');

    if (navigator.share) {
        navigator.share({
            title: `Trusttec — ${qvProduct.name}`,
            text: `Découvrez ${qvProduct.name} à ${Number(qvProduct.price).toLocaleString('fr-FR')} XAF sur Trusttec !`,
            url: url
        }).catch(() => { });
    } else {
        navigator.clipboard.writeText(url).then(() => {
            shareBtn.className = 'btn-share copied';
            shareBtn.innerHTML = '<i class="bi bi-check-lg"></i><span class="d-none d-sm-inline">Copié !</span>';

            const toast = document.getElementById('share-toast');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);

            setTimeout(() => {
                shareBtn.className = 'btn-share';
                shareBtn.innerHTML = '<i class="bi bi-share"></i><span class="d-none d-sm-inline">Partager</span>';
            }, 2500);
        }).catch(() => {
            const waText = encodeURIComponent(`Regarde ce produit sur Trusttec : ${url}`);
            window.open(`https://wa.me/?text=${waText}`, '_blank');
        });
    }
});

document.getElementById('qv-variants-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    const index = parseInt(btn.dataset.index);
    const delta = parseInt(btn.dataset.delta);
    let newQty = qvVariantsState[index].qty + delta;
    if (qvVariantsState.length === 1 && qvVariantsState[0].colorName === '') {
        if (newQty < 1) newQty = 1;
    } else {
        if (newQty < 0) newQty = 0;
    }
    qvVariantsState[index].qty = newQty;
    document.getElementById(`var-qty-${index}`).textContent = newQty;
    refreshQVChatButton();
});

function refreshQVChatButton() {
    if (!qvProduct) return;
    const totalItems = qvVariantsState.reduce((sum, v) => sum + (v.qty > 0 ? v.qty : 0), 0);
    const chatBtn = document.getElementById('qv-chat-btn');
    chatBtn.disabled = totalItems === 0;
}

let qvConvId = null;
let qvMessageSub = null;
let qvChatActive = false;

function resetQVChat() {
    if (qvMessageSub) { qvMessageSub.unsubscribe(); qvMessageSub = null; }
    stopQVPolling();
    if (qvConvId && qvProduct) {
        sessionStorage.setItem(`qv_conv_${qvProduct.id}`, qvConvId);
    }
    qvConvId = null;
    qvChatActive = false;
}

function formatChatTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function openQVChat() {
    if (!qvProduct || qvChatActive) return;
    const { getUser } = await import('./auth.js');
    const user = getUser();
    if (!user) {
        new bootstrap.Modal(document.getElementById('authModal')).show();
        return;
    }

    if (isAdmin()) {
        qvModal.hide();
        const toggleBtn = document.getElementById('chat-toggle-btn');
        if (toggleBtn) toggleBtn.click();
        return;
    }

    qvChatActive = true;

    const detailsEl = document.getElementById('qv-details');
    const chatPanelEl = document.getElementById('qv-chat-panel');
    const msgListEl = document.getElementById('qv-chat-messages');
    const inputAreaEl = document.getElementById('qv-chat-input-area');
    const productLabelEl = document.getElementById('qv-chat-product');

    if (!chatPanelEl || !msgListEl) { qvChatActive = false; return; }

    if (detailsEl) detailsEl.style.display = 'none';
    chatPanelEl.style.display = 'flex';
    if (productLabelEl) productLabelEl.textContent = qvProduct.name;

    msgListEl.innerHTML = '<div class="trusttc-empty-chat"><i class="bi bi-chat-dots"></i><p>Connexion au service client...</p></div>';
    if (inputAreaEl) inputAreaEl.style.display = 'none';

    const savedKey = `qv_conv_${qvProduct.id}`;
    const savedConvId = sessionStorage.getItem(savedKey);

    if (savedConvId) {
        const { data: existingConv, error: convErr } = await supabase.from('conversations').select('id').eq('id', savedConvId).maybeSingle();
        if (!convErr && existingConv) {
            qvConvId = savedConvId;
        } else {
            if (convErr) console.warn('Conversation sauvegardée introuvable:', convErr);
            sessionStorage.removeItem(savedKey);
        }
    }

    if (!qvConvId) {
        const { createProductConversation, loadConversations: syncWidgetConversations } = await import('./chat.js');
        const conv = await createProductConversation(qvProduct.name);
        if (!conv) {
            msgListEl.innerHTML = '<div class="trusttc-empty-chat"><i class="bi bi-exclamation-triangle"></i><p>Erreur de connexion. Réessayez.</p></div>';
            qvChatActive = false;
            return;
        }
        qvConvId = conv.id;
        sessionStorage.setItem(savedKey, qvConvId);
        syncWidgetConversations(true);
    }

    const existingEmpty = msgListEl.querySelector('.trusttc-empty-chat');
    if (existingEmpty) existingEmpty.remove();
    if (inputAreaEl) inputAreaEl.style.display = 'flex';

    await loadQVChatMessages();
    subscribeQVChatMessages();
}

async function loadQVChatMessages() {
    if (!qvConvId) return;
    const list = document.getElementById('qv-chat-messages');
    const { data: messages, error } = await supabase
        .rpc('get_conv_messages', { conv_id: qvConvId });

    if (error) {
        console.error('Erreur chargement messages QV:', error);
        list.innerHTML = '<div class="trusttc-empty-chat"><i class="bi bi-exclamation-triangle text-danger" style="font-size:32px;"></i><p class="text-danger">Erreur de chargement.</p><button class="btn btn-sm btn-outline-primary mt-2" id="qv-retry-msgs"><i class="bi bi-arrow-repeat me-1"></i>Réessayer</button></div>';
        document.getElementById('qv-retry-msgs')?.addEventListener('click', () => loadQVChatMessages());
        return;
    }

    if (!messages || messages.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'trusttc-empty-chat';
        emptyMsg.innerHTML = '<i class="bi bi-chat"></i><p>Envoyez votre premier message !</p>';
        list.appendChild(emptyMsg);
        return;
    }

    const user = (await import('./auth.js')).getUser();
    list.innerHTML = messages.map(msg => {
        const isSent = msg.sender_id === user?.id;
        const time = formatChatTime(msg.created_at);
        const safeContent = escapeHtml(msg.content);
        if (isSent) {
            return `<div class="trusttec-msg sent"><div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div></div>`;
        }
        const safeName = escapeHtml(msg.sender_name || 'Inconnu');
        const avatar = msg.sender_avatar
            ? `<img class="msg-avatar" src="${msg.sender_avatar}" alt="" onerror="this.style.display='none'">`
            : `<div class="msg-avatar msg-avatar-placeholder">${safeName.charAt(0).toUpperCase()}</div>`;
        return `<div class="trusttec-msg received">
            <div class="msg-sender-line">${avatar}<span class="msg-sender-name">${safeName}</span></div>
            <div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div>
        </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
}

function subscribeQVChatMessages() {
    if (qvMessageSub) qvMessageSub.unsubscribe();

    qvMessageSub = supabase
        .channel(`qv-messages:${qvConvId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${qvConvId}`
        }, async (payload) => {
            const list = document.getElementById('qv-chat-messages');
            if (!list) return;
            const empty = list.querySelector('.trusttc-empty-chat');
            if (empty) empty.remove();

            const { getUser } = await import('./auth.js');
            const user = getUser();
            const isSent = payload.new.sender_id === user?.id;
            const time = formatChatTime(payload.new.created_at);

            const msgEl = document.createElement('div');
            msgEl.className = `trusttec-msg ${isSent ? 'sent' : 'received'}`;
            const safeContent = escapeHtml(payload.new.content);
            if (isSent) {
                msgEl.innerHTML = `<div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div>`;
            } else {
                let senderName = 'Inconnu';
                let avatarHtml = '<div class="msg-avatar msg-avatar-placeholder">?</div>';
                if (payload.new.sender_name) {
                    senderName = payload.new.sender_name;
                    avatarHtml = payload.new.sender_avatar
                        ? `<img class="msg-avatar" src="${payload.new.sender_avatar}" alt="" onerror="this.style.display='none'">`
                        : `<div class="msg-avatar msg-avatar-placeholder">${senderName.charAt(0).toUpperCase()}</div>`;
                } else {
                    if (!window._qvProfileCache) window._qvProfileCache = {};
                    if (!window._qvProfileCache[payload.new.sender_id]) {
                        const { data: profile } = await supabase.from('profiles').select('full_name, email, avatar_url').eq('id', payload.new.sender_id).maybeSingle();
                        if (profile) window._qvProfileCache[payload.new.sender_id] = profile;
                    }
                    const cached = window._qvProfileCache[payload.new.sender_id];
                    if (cached) {
                        senderName = cached.full_name || cached.email?.split('@')[0] || 'Inconnu';
                        avatarHtml = cached.avatar_url
                            ? `<img class="msg-avatar" src="${cached.avatar_url}" alt="" onerror="this.style.display='none'">`
                            : `<div class="msg-avatar msg-avatar-placeholder">${senderName.charAt(0).toUpperCase()}</div>`;
                    }
                }
                msgEl.innerHTML = `<div class="msg-sender-line">${avatarHtml}<span class="msg-sender-name">${escapeHtml(senderName)}</span></div><div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div>`;
            }
            list.appendChild(msgEl);
            list.scrollTop = list.scrollHeight;

            if (!isSent) {
                const { loadConversations: syncWidget } = await import('./chat.js');
                syncWidget(true);
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                qvSubscriptionHealthy = true;
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Realtime QV chat error, starting polling');
                qvSubscriptionHealthy = false;
                startQVPolling();
            }
        });
}

let qvPollingInterval = null;
let qvSubscriptionHealthy = false;

function startQVPolling() {
    if (qvPollingInterval) return;
    qvPollingInterval = setInterval(async () => {
        if (!qvConvId) { stopQVPolling(); return; }
        if (!qvSubscriptionHealthy) {
            const { data: messages } = await supabase
                .from('messages')
                .select('id')
                .eq('conversation_id', qvConvId)
                .order('created_at', { ascending: false })
                .limit(1);
            if (messages?.length) await loadQVChatMessages();
        }
    }, 3000);
}

function stopQVPolling() {
    if (qvPollingInterval) { clearInterval(qvPollingInterval); qvPollingInterval = null; }
}

async function sendQVChatMessage() {
    if (!qvConvId) return;
    const input = document.getElementById('qv-chat-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    const { getUser } = await import('./auth.js');
    const user = getUser();
    if (!user) return;

    input.value = '';
    input.disabled = true;

    const list = document.getElementById('qv-chat-messages');
    const empty = list?.querySelector('.trusttc-empty-chat');
    if (empty) empty.remove();

    try {
        await supabase.rpc('send_chat_msg', {
            conv_id: qvConvId,
            sender_id: user.id,
            content
        });
    } catch (err) {
        console.error('Erreur envoi message QV:', err);
    } finally {
        input.disabled = false;
        input.focus();
    }
}

document.getElementById('qv-chat-btn')?.addEventListener('click', openQVChat);

document.getElementById('qv-chat-back')?.addEventListener('click', () => {
    resetQVChat();
    document.getElementById('qv-chat-panel').style.display = 'none';
    document.getElementById('qv-details').style.display = 'block';
});

document.getElementById('qv-chat-send')?.addEventListener('click', sendQVChatMessage);
document.getElementById('qv-chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQVChatMessage(); }
});

document.getElementById('quickViewModal')?.addEventListener('hidden.bs.modal', () => {
    if (qvChatActive || qvConvId || qvMessageSub) {
        resetQVChat();
        document.getElementById('qv-chat-panel').style.display = 'none';
        document.getElementById('qv-details').style.display = 'block';
    }
});

document.getElementById('qv-add-cart').addEventListener('click', () => {
    if (!qvProduct) return;
    let itemsAdded = 0;
    qvVariantsState.forEach(v => {
        if (v.qty > 0) {
            document.dispatchEvent(new CustomEvent('addToCartCustom', {
                detail: {
                    id: qvProduct.id,
                    name: qvProduct.name,
                    price: qvProduct.price,
                    img: qvProduct.image_url,
                    colorName: v.colorName,
                    colorHex: v.colorHex,
                    qty: v.qty
                }
            }));
            itemsAdded++;
        }
    });
    if (itemsAdded === 0) {
        alert("Veuillez ajouter au moins une quantité avec le bouton (+)");
        return;
    }
    const btn = document.getElementById('qv-add-cart');
    btn.innerHTML = '<i class="bi bi-check-lg me-2"></i>Produits ajoutés !';
    btn.style.background = '#198754';
    setTimeout(() => {
        btn.innerHTML = '<i class="bi bi-cart-plus me-2"></i>Ajouter au panier';
        btn.style.background = '';
        qvModal.hide();
    }, 1400);
});

function initColorSwatcher(colors, defaultImage) {
    if (!colors || !colors.length) return;

    const mainImg   = document.getElementById('qv-img');
    const nameEl    = document.getElementById('selected-color-name');
    const container = document.getElementById('color-swatches');
    if (!container) return;

    container.innerHTML = colors.map((c, i) => `
        <button
            class="color-swatch"
            data-hex="${esc(c.hex)}"
            data-name="${esc(c.name)}"
            data-image="${esc(c.image_url || '')}"
            title="${esc(c.name)}"
            aria-label="Couleur ${esc(c.name)}"
            style="
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: ${esc(c.hex)};
                border: 2px solid transparent;
                cursor: pointer;
                outline: none;
                transition: transform .15s, box-shadow .15s;
                ${i === 0 ? `box-shadow: 0 0 0 2px white, 0 0 0 4px ${esc(c.hex)};` : ''}
            ">
        </button>
    `).join('');

    if (nameEl && colors[0]) nameEl.textContent = colors[0].name;

    container.querySelectorAll('.color-swatch').forEach(btn => {
        btn.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.2)';
        });
        btn.addEventListener('mouseleave', function () {
            this.style.transform = '';
        });
        btn.addEventListener('click', function () {
            container.querySelectorAll('.color-swatch').forEach(s => {
                s.style.boxShadow = '';
                s.style.border    = '2px solid transparent';
            });

            this.style.boxShadow = `0 0 0 2px white, 0 0 0 4px ${this.dataset.hex}`;

            if (nameEl) nameEl.textContent = this.dataset.name;

            if (mainImg) {
                const newSrc = this.dataset.image || defaultImage;
                mainImg.style.opacity = '0';
                setTimeout(() => {
                    mainImg.src           = newSrc;
                    mainImg.style.opacity = '1';
                }, 200);
            }
        });
    });
}

function safeJSON(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val); } catch { return []; }
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

loadProducts();
