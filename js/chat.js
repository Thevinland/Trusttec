import { getSupabase, getUser, getProfile, isAdmin, showToast, onAuthChange } from './auth.js';

let supabase = null;
let conversations = [];
let activeConversationId = null;
let messageSubscription = null;
let unreadTotal = 0;
let chatInitialized = false;
const profileCache = {};
let pendingDeleteCallback = null;
let chatSubscriptionHealthy = false;
function getSuppressAutoCreate() { return sessionStorage.getItem('chat_suppress_auto') === '1'; }
function setSuppressAutoCreate(v) { if (v) sessionStorage.setItem('chat_suppress_auto', '1'); else sessionStorage.removeItem('chat_suppress_auto'); }

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
let chatDeleteModal = null;

const CHAT_STYLES = `
#trusttec-chat-widget {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1050;
  font-family: 'Manrope', sans-serif;
}

.trusttec-chat-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #0d6efd;
  color: white;
  border: none;
  box-shadow: 0 4px 20px rgba(13,110,253,0.35);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  transition: all .2s;
  position: relative;
}

.trusttec-chat-btn:hover { transform: scale(1.08); background: #0b5ed7; }

.trusttec-chat-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #dc3545;
  color: white;
  font-size: 11px;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  display: none;
}

.trusttec-chat-panel {
  position: absolute;
  bottom: 68px;
  right: 0;
  width: min(360px, calc(100vw - 48px));
  max-height: min(520px, calc(100vh - 108px));
  height: auto;
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  display: none;
  flex-direction: column;
  overflow: hidden;
}

.trusttec-chat-panel.open { display: flex; }

.trusttec-chat-header {
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  color: white;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.trusttec-chat-header h6 { margin: 0; font-weight: 700; font-size: 14px; }
.trusttec-chat-header small { font-size: 11px; opacity: 0.7; }
.trusttec-chat-close { background: none; border: none; color: white; opacity: 0.7; cursor: pointer; font-size: 18px; padding: 0; line-height: 1; }

.trusttec-chat-body {
  flex: 1;
  overflow: hidden;
  background: #f8f9fa;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.trusttec-chat-conversations { flex: 1; overflow-y: auto; min-height: 0; padding: 8px; }
.trusttec-chat-conversation {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background .15s;
}
.trusttec-chat-conversation:hover { background: #e9ecef; }
.trusttec-chat-conversation.active { background: #d0e2ff; }
.trusttec-conv-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: #0d6efd; color: white;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 16px; flex-shrink: 0;
}
.trusttec-conv-info { flex: 1; min-width: 0; }
.trusttec-conv-name { font-weight: 700; font-size: 13px; color: #1a1a2e; }
.trusttec-conv-last { font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trusttec-conv-time { font-size: 10px; color: #aaa; flex-shrink: 0; }
.trusttec-conv-unread {
  background: #dc3545; color: white; font-size: 10px; font-weight: 700;
  min-width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; padding: 0 5px;
}
.trusttec-chat-new-btn {
  display: block; width: calc(100% - 16px); margin: 8px; padding: 8px;
  border: 2px dashed #dee2e6; border-radius: 10px; background: none;
  color: #666; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s;
}
.trusttec-chat-new-btn:hover { border-color: #0d6efd; color: #0d6efd; background: #f0f4ff; }

.trusttec-chat-messages { display: none; flex-direction: column; flex: 1; min-height: 0; }
.trusttec-chat-messages.active { display: flex; }
.trusttec-msg-header {
  padding: 10px 16px; background: white; border-bottom: 1px solid #eee;
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
}
.trusttec-msg-back { background: none; border: none; color: #0d6efd; cursor: pointer; font-size: 18px; padding: 0; }
.trusttec-msg-with { font-weight: 700; font-size: 14px; }
.trusttec-msg-delete { background: none; border: none; color: #dc3545; cursor: pointer; font-size: 16px; padding: 4px; opacity: 0.5; transition: opacity .15s; flex-shrink: 0; line-height: 1; }
.trusttec-msg-delete:hover { opacity: 1; }

.trusttec-msg-list { flex: 1; overflow-y: auto; min-height: 0; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.trusttec-msg { max-width: 80%; display: flex; flex-direction: column; }
.trusttec-msg.sent { align-self: flex-end; }
.trusttec-msg.received { align-self: flex-start; }
.trusttec-msg .msg-bubble { padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.4; word-wrap: break-word; }
.trusttec-msg.sent .msg-bubble { background: #0d6efd; color: white; border-bottom-right-radius: 4px; }
.trusttec-msg.received .msg-bubble { background: white; color: #1a1a2e; border: 1px solid #e9ecef; border-bottom-left-radius: 4px; }
.trusttec-msg-time { font-size: 10px; opacity: 0.6; margin-top: 4px; display: block; }
.msg-sender-line { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; margin-left: 4px; }
.msg-avatar { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.msg-avatar-placeholder { width: 24px; height: 24px; border-radius: 50%; background: #0d6efd; color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.msg-sender-name { font-size: 11px; font-weight: 600; color: #0d6efd; }

.trusttec-msg-input-area {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: white; border-top: 1px solid #eee; flex-shrink: 0;
}
.trusttec-msg-input {
  flex: 1; border: 1.5px solid #dee2e6; border-radius: 20px; padding: 8px 14px; font-size: 13px; outline: none;
}
.trusttec-msg-input:focus { border-color: #0d6efd; }
.trusttec-msg-send {
  width: 36px; height: 36px; border-radius: 50%; background: #0d6efd; color: white;
  border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
}
.trusttec-msg-send:hover { background: #0b5ed7; }

.trusttc-empty-chat {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; color: #aaa; padding: 20px; text-align: center;
}
.trusttc-empty-chat i { font-size: 48px; margin-bottom: 12px; }
.trusttc-empty-chat p { margin: 0; font-size: 14px; }

@media (max-width: 480px) {
  #trusttec-chat-widget { bottom: 0; right: 0; }
  .trusttec-chat-panel {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    width: 100%; max-height: 100%; border-radius: 0;
  }
  .trusttec-chat-btn { margin: 12px; }
}
`;

let chatStylesInjected = false;

function injectStyles() {
  if (chatStylesInjected) return;
  const style = document.createElement('style');
  style.textContent = CHAT_STYLES;
  document.head.appendChild(style);
  chatStylesInjected = true;
}

export function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;
  supabase = getSupabase();
  injectStyles();
  buildChatWidget();
  setupRealtime();

  document.getElementById('chat-conversations-list')?.addEventListener('click', (e) => {
    const item = e.target.closest('.trusttec-chat-conversation');
    if (item) openConversation(item.dataset.convId);
    const newBtn = e.target.closest('#start-new-chat');
    if (newBtn) startNewChat();
    const deleteBtn = e.target.closest('#delete-all-chat-btn');
    if (deleteBtn) {
      const count = conversations.length;
      document.getElementById('chat-delete-msg').innerHTML = `Masquer les <strong>${count}</strong> conversation${count > 1 ? 's' : ''} ?<br><small class="text-muted">Elles réapparaîtront si l'équipe vous répond.</small>`;
      pendingDeleteCallback = () => deleteAllUserConversations();
      chatDeleteModal.show();
    }
  });
}

function buildChatWidget() {
  if (document.getElementById('trusttec-chat-widget')) return;

  const widget = document.createElement('div');
  widget.id = 'trusttec-chat-widget';
  widget.innerHTML = `
    <div class="trusttec-chat-panel" id="chat-panel">
      <div class="trusttec-chat-header">
        <div>
          <h6><i class="bi bi-chat-dots me-1"></i>Trusttec Chat</h6>
          <small>Service client</small>
        </div>
        <button class="trusttec-chat-close" id="chat-close-btn"><i class="bi bi-x-lg"></i></button>
      </div>

      <div class="trusttec-chat-body" id="chat-body">
        <div class="trusttec-chat-conversations" id="chat-conversations-list">
          <div class="trusttc-empty-chat">
            <i class="bi bi-chat-dots"></i>
            <p>Connectez-vous pour chatter avec nous !</p>
          </div>
        </div>
        <div class="trusttec-chat-messages" id="chat-messages-view">
          <div class="trusttec-msg-header">
            <button class="trusttec-msg-back" id="msg-back-btn"><i class="bi bi-arrow-left"></i></button>
            <img id="msg-product-img" src="" alt="" style="width:32px;height:32px;border-radius:6px;object-fit:cover;display:none;flex-shrink:0;">
            <div style="min-width:0;flex:1;">
              <div class="trusttec-msg-with" id="msg-with-label">Conversation</div>
              <small id="msg-product-label" class="text-muted" style="font-size:11px;"></small>
            </div>
            <button class="trusttec-msg-delete" id="msg-delete-btn" title="Supprimer la conversation"><i class="bi bi-trash"></i></button>
          </div>
          <div class="trusttec-msg-list" id="msg-list"></div>
          <div class="trusttec-msg-input-area">
            <input type="text" class="trusttec-msg-input" id="msg-input" placeholder="Écrivez votre message..." autocomplete="off">
            <button class="trusttec-msg-send" id="msg-send-btn"><i class="bi bi-send-fill"></i></button>
          </div>
        </div>
      </div>
    </div>

    <button class="trusttec-chat-btn" id="chat-toggle-btn">
      <i class="bi bi-chat-dots"></i>
      <span class="trusttec-chat-badge" id="chat-unread-badge">0</span>
    </button>
  `;

  document.body.appendChild(widget);

  const chatDeleteModalHtml = `
    <div class="modal fade" id="chat-delete-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-sm">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title fw-bold text-danger"><i class="bi bi-trash me-2"></i>Supprimer ?</h5>
          </div>
          <div class="modal-body">
            <p id="chat-delete-msg"></p>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Annuler</button>
            <button class="btn btn-danger btn-sm fw-bold" id="chat-confirm-delete-btn">Supprimer</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', chatDeleteModalHtml);
  chatDeleteModal = new bootstrap.Modal(document.getElementById('chat-delete-modal'));
  document.getElementById('chat-confirm-delete-btn').addEventListener('click', () => {
    if (typeof pendingDeleteCallback === 'function') {
      chatDeleteModal.hide();
      pendingDeleteCallback();
      pendingDeleteCallback = null;
    }
  });

  const toggleBtn = document.getElementById('chat-toggle-btn');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close-btn');

  toggleBtn.addEventListener('click', async () => {
    if (panel.classList.contains('open')) {
      if (activeConversationId) {
        sessionStorage.setItem('chat_active_conv', activeConversationId);
      } else {
        sessionStorage.removeItem('chat_active_conv');
      }
      showConversationsList();
      panel.classList.remove('open');
    } else {
      panel.classList.add('open');
      await loadConversations();
      resetUnreadBadge();
      const savedConvId = sessionStorage.getItem('chat_active_conv');
      if (savedConvId) {
        sessionStorage.removeItem('chat_active_conv');
        if (conversations.some(c => c.id === savedConvId)) {
          openConversation(savedConvId);
        }
      }
    }
  });

  closeBtn.addEventListener('click', () => {
    if (activeConversationId) {
      sessionStorage.setItem('chat_active_conv', activeConversationId);
    } else {
      sessionStorage.removeItem('chat_active_conv');
    }
    showConversationsList();
    panel.classList.remove('open');
  });

  document.getElementById('msg-back-btn').addEventListener('click', () => {
    showConversationsList();
    loadConversations();
  });

  document.getElementById('msg-send-btn').addEventListener('click', sendMessage);
  document.getElementById('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById('msg-delete-btn').addEventListener('click', () => {
    const conv = conversations.find(c => c.id === activeConversationId);
    const name = isAdmin() ? (conv?.withName || 'cet utilisateur') : "l'équipe Trusttec";
    document.getElementById('chat-delete-msg').innerHTML = `Masquer la conversation avec <strong>${name}</strong> ?<br><small class="text-muted">Elle réapparaîtra si l'équipe vous répond.</small>`;
    const capturedId = activeConversationId;
    pendingDeleteCallback = () => deleteUserConversation(capturedId);
    chatDeleteModal.show();
  });

  window.addEventListener('beforeunload', () => {
    if (activeConversationId) {
      sessionStorage.setItem('chat_active_conv', activeConversationId);
    }
  });
}

async function ensureAdminConversation() {
  const user = getUser();
  if (!user) return null;

  const profile = getProfile();
  if (!profile) return null;

  if (isAdmin()) return null;

  if (getSuppressAutoCreate()) return null;

  let existingConv = conversations.find(c => c.participants?.some(p => p.role === 'admin'));
  if (existingConv) return existingConv;

  const { data: existing } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('profile_id', user.id);

  if (existing && existing.length > 0) {
    const convIds = existing.map(p => p.conversation_id);
    const { data: allParts } = await supabase
      .rpc('get_batch_conv_participants', { conv_ids: convIds, my_id: user.id });
    const adminConvId = allParts?.find(p => p.role === 'admin')?.conv_id;
    if (adminConvId) {
      const { data: conv, error: convErr } = await supabase.from('conversations').select('*').eq('id', adminConvId).maybeSingle();
      if (!convErr && conv) return conv;
    }
  }

  const { data: convId, error } = await supabase.rpc('create_conv_with_admin', {
    subject: 'Support Trusttec',
    user_id: user.id
  });

  if (error || !convId) return null;

  const { data: conv } = await supabase.from('conversations').select('*').eq('id', convId).maybeSingle();
  return conv || null;
}

export async function loadConversations(skipEnsure = false) {
  const user = getUser();
  if (!user) {
    document.getElementById('chat-conversations-list').innerHTML = `
      <div class="trusttc-empty-chat">
        <i class="bi bi-person-circle"></i>
        <p>Connectez-vous pour discuter avec notre équipe</p>
        <button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#authModal">
          <i class="bi bi-box-arrow-in-right me-1"></i> Connexion
        </button>
      </div>`;
    return;
  }

  try {
    const { data: participants, error: partErr } = await supabase
      .from('conversation_participants')
      .select('conversation_id, unread_count, conversations(*)')
      .eq('profile_id', user.id)
      .is('deleted_at', null)
      .order('conversation_id', { ascending: false });

    if (partErr) throw partErr;

    conversations = (participants || []).map(p => ({
      ...p.conversations,
      unread_count: p.unread_count
    }));

    const convIds = conversations.map(c => c.id);
    if (convIds.length > 0) {
      const { data: allParts, error: batchErr } = await supabase
        .rpc('get_batch_conv_participants', { conv_ids: convIds, my_id: user.id });
      if (batchErr) throw batchErr;
      const partsByConv = {};
      (allParts || []).forEach(p => {
        if (!partsByConv[p.conv_id]) partsByConv[p.conv_id] = [];
        partsByConv[p.conv_id].push(p);
      });
      conversations.forEach(conv => {
        conv.participants = partsByConv[conv.id] || [];
        conv.withName = isAdmin() ? (conv.participants[0]?.full_name || conv.participants[0]?.email || 'Client inconnu') : 'Équipe Trusttec';
      });
    }

    if (!isAdmin() && !skipEnsure && conversations.length === 0) {
      await ensureAdminConversation();
    }

    unreadTotal = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    updateUnreadBadge();
  } catch (err) {
    console.error('Erreur chargement conversations:', err);
  }

  renderConversationsList();
}

function renderConversationsList() {
  const list = document.getElementById('chat-conversations-list');
  const user = getUser();
  const profile = getProfile();

  if (conversations.length === 0) {
    list.innerHTML = `
      <div class="trusttc-empty-chat">
        <i class="bi bi-chat-dots"></i>
        <p>Aucune conversation</p>
      </div>
      ${!isAdmin() ? '<button class="trusttec-chat-new-btn" id="start-new-chat"><i class="bi bi-plus-circle me-1"></i> Nouvelle conversation</button>' : ''}`;
    return;
  }

  let html = '';
  conversations.sort((a, b) => {
    const aTime = a.last_message_at || a.created_at;
    const bTime = b.last_message_at || b.created_at;
    return new Date(bTime) - new Date(aTime);
  });

  conversations.forEach(conv => {
    const time = conv.last_message_at || conv.created_at;
    const timeStr = time ? formatTime(time) : '';
    const lastMsg = conv.last_message ? (conv.last_message.length > 40 ? conv.last_message.substring(0, 40) + '...' : conv.last_message) : 'Aucun message';
    const initial = conv.withName ? conv.withName.charAt(0).toUpperCase() : '?';
    const unread = conv.unread_count || 0;
    const subject = conv.subject || '';
    const showProduct = isAdmin() && subject && subject !== 'Support Trusttec';

    html += `
      <div class="trusttec-chat-conversation ${activeConversationId === conv.id ? 'active' : ''}" data-conv-id="${conv.id}">
        <div class="trusttec-conv-avatar">${initial}</div>
        <div class="trusttec-conv-info">
          <div class="trusttec-conv-name">${conv.withName}</div>
          ${showProduct ? `<div class="trusttec-conv-product" style="font-size:11px;color:#0d6efd;font-weight:600;margin-bottom:1px;">${subject}</div>` : ''}
          <div class="trusttec-conv-last">${lastMsg}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <div class="trusttec-conv-time">${timeStr}</div>
          ${unread > 0 ? `<div class="trusttec-conv-unread">${unread}</div>` : ''}
        </div>
      </div>`;
  });

  if (!isAdmin()) {
    html += `<button class="trusttec-chat-new-btn" id="start-new-chat"><i class="bi bi-plus-circle me-1"></i> Nouveau message</button>`;
  }

  html += `<div class="d-flex px-3 py-2 border-top" style="flex-shrink:0;">
    <button class="btn btn-sm btn-outline-danger w-100" id="delete-all-chat-btn"><i class="bi bi-trash me-1"></i> Tout supprimer</button>
  </div>`;

  list.innerHTML = html;
}

function startNewChat() {
  setSuppressAutoCreate(false);
  if (!getUser()) {
    const panel = document.getElementById('chat-panel');
    panel.classList.remove('open');
    const authModal = new bootstrap.Modal(document.getElementById('authModal'));
    authModal.show();
    return;
  }
  ensureAdminConversation().then(() => loadConversations());
}

async function openConversation(convId) {
  if (messageSubscription) {
    messageSubscription.unsubscribe();
    messageSubscription = null;
  }

  let conv = conversations.find(c => c.id === convId);
  if (!conv) {
    await loadConversations(true);
    conv = conversations.find(c => c.id === convId);
    if (!conv) {
      showConversationsList();
      return;
    }
  }

  activeConversationId = convId;

  const prodLabel = document.getElementById('msg-product-label');
  const prodImg = document.getElementById('msg-product-img');
  const subject = conv.subject || '';

  const storedInfo = sessionStorage.getItem(`product_conv_${convId}`);
  if (storedInfo) {
    try {
      const info = JSON.parse(storedInfo);
      document.getElementById('msg-with-label').textContent = 'Service Client';
      prodLabel.textContent = info.name;
      prodLabel.style.display = 'block';
      if (info.image) {
        prodImg.src = info.image;
        prodImg.style.display = 'inline';
      } else {
        prodImg.style.display = 'none';
      }
    } catch (e) {
      prodLabel.style.display = 'none';
      prodImg.style.display = 'none';
    }
  } else if (subject && subject !== 'Support Trusttec') {
    document.getElementById('msg-with-label').textContent = 'Service Client';
    prodLabel.textContent = subject;
    prodLabel.style.display = 'block';
    prodImg.style.display = 'none';
  } else {
    document.getElementById('msg-with-label').textContent = isAdmin() ? (conv.withName || 'Conversation') : 'Équipe Trusttec';
    prodLabel.style.display = 'none';
    prodImg.style.display = 'none';
  }
  document.getElementById('chat-conversations-list').style.display = 'none';
  document.getElementById('chat-messages-view').classList.add('active');

  try { await markAsRead(convId); } catch (e) { console.warn('markAsRead failed:', e); }
  await loadMessages(convId);
  subscribeToMessages(convId);
}

function showConversationsList() {
  activeConversationId = null;
  document.getElementById('chat-conversations-list').style.display = 'block';
  document.getElementById('chat-messages-view').classList.remove('active');
  document.getElementById('msg-product-label').style.display = 'none';
  document.getElementById('msg-list').innerHTML = '';
  if (messageSubscription) {
    messageSubscription.unsubscribe();
    messageSubscription = null;
  }
  stopChatPolling();
}

async function deleteUserConversation(convId) {
  const user = getUser();
  if (!user) return;

  console.log('[CHAT DEBUG] deleteUserConversation:', convId, '| activeConversationId avant:', activeConversationId);

  try {
    const { error } = await supabase.rpc('delete_user_conversation', {
      conv_id: convId,
      user_id: user.id
    });

    if (error) throw error;

    console.log('[CHAT DEBUG] RPC delete ok, filtered conversations avant:', conversations.map(c => c.id));

    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }
    stopChatPolling();

    conversations = conversations.filter(c => c.id !== convId);

    console.log('[CHAT DEBUG] conversations après filtre:', conversations.map(c => c.id));

    if (conversations.length === 0) setSuppressAutoCreate(true);

    sessionStorage.removeItem('chat_active_conv');

    if (activeConversationId === convId || !activeConversationId) {
      showConversationsList();
    }
    renderConversationsList();
    updateUnreadBadge();

    showToast('Conversation supprimée.', 'warning');
  } catch (err) {
    console.error('Erreur suppression conversation:', err);
    showToast('Erreur lors de la suppression.', 'error');
  }
}

async function deleteAllUserConversations() {
  const user = getUser();
  if (!user || conversations.length === 0) return;

  const ids = conversations.map(c => c.id);

  try {
    const { error } = await supabase.rpc('delete_all_user_conversations', {
      user_id: user.id
    });

    if (error) throw error;

    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }
    stopChatPolling();

    conversations = [];
    setSuppressAutoCreate(true);
    sessionStorage.removeItem('chat_active_conv');
    showConversationsList();
    renderConversationsList();
    updateUnreadBadge();

    showToast(`${ids.length} conversation${ids.length > 1 ? 's' : ''} masquée${ids.length > 1 ? 's' : ''}.`, 'warning');
  } catch (err) {
    console.error('Erreur masquage conversations:', err);
    showToast('Erreur lors du masquage.', 'error');
  }
}

async function markAsRead(convId) {
  const user = getUser();
  if (!user) return;

  await supabase.rpc('mark_conversation_read', {
    p_conv_id: convId,
    p_profile_id: user.id
  });

  const conv = conversations.find(c => c.id === convId);
  if (conv) conv.unread_count = 0;

  unreadTotal = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  updateUnreadBadge();
}

async function loadMessages(convId) {
  const user = getUser();
  if (!user) {
    console.warn('loadMessages: no authenticated user');
    return;
  }

  const list = document.getElementById('msg-list');
  list.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Chargement...</div>';

  console.log('[CHAT DEBUG] loadMessages convId:', convId, '| activeConversationId:', activeConversationId, '| conversations:', conversations.map(c => c.id));

  const { data: messages, error } = await supabase
    .rpc('get_conv_messages', { conv_id: convId });

  if (error) {
    console.error('[CHAT DEBUG] Erreur chargement messages:', error);
    list.innerHTML = '<div class="text-center py-4 text-muted"><i class="bi bi-exclamation-triangle text-danger fs-4 d-block mb-2"></i><p class="text-danger">Erreur de chargement. Veuillez réessayer.</p><button class="btn btn-sm btn-outline-primary mt-2" id="retry-load-msgs"><i class="bi bi-arrow-repeat me-1"></i>Réessayer</button></div>';
    document.getElementById('retry-load-msgs')?.addEventListener('click', () => loadMessages(convId));
    return;
  }

  console.log('[CHAT DEBUG] Messages loaded count:', messages?.length, 'for convId:', convId);
  renderMessages(messages || []);
}

function renderMessages(messages) {
  const list = document.getElementById('msg-list');
  const user = getUser();

  if (messages.length === 0) {
    list.innerHTML = `<div class="trusttc-empty-chat" style="height:auto;padding:30px 12px;">
      <i class="bi bi-chat" style="font-size:32px;"></i>
      <p>Envoyez votre premier message !</p>
    </div>`;
    return;
  }

  list.innerHTML = messages.map(msg => {
    const isSent = msg.sender_id === user?.id;
    const time = formatTime(msg.created_at);
    const safeContent = escapeHtml(msg.content);
    if (isSent) {
      return `<div class="trusttec-msg sent">
        <div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div>
      </div>`;
    }
    const safeName = escapeHtml(msg.sender_name || 'Inconnu');
    const avatar = msg.sender_avatar ? `<img class="msg-avatar" src="${msg.sender_avatar}" alt="" onerror="this.style.display='none'">` : '<div class="msg-avatar msg-avatar-placeholder">' + (safeName.charAt(0).toUpperCase()) + '</div>';
    return `<div class="trusttec-msg received">
      <div class="msg-sender-line">${avatar}<span class="msg-sender-name">${safeName}</span></div>
      <div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div>
    </div>`;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

async function sendMessage() {
  if (!activeConversationId || !getUser()) return;
  const input = document.getElementById('msg-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const list = document.getElementById('msg-list');
  const empty = list?.querySelector('.trusttc-empty-chat');
  if (empty) empty.remove();

  input.disabled = true;

  try {
    await supabase.rpc('send_chat_msg', {
      conv_id: activeConversationId,
      sender_id: getUser().id,
      content
    });
    input.value = '';
  } catch (err) {
    console.error('Erreur envoi message:', err);
    showToast("Erreur d'envoi. Vérifiez votre connexion.", 'error');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function subscribeToMessages(convId) {
  if (messageSubscription) {
    messageSubscription.unsubscribe();
    messageSubscription = null;
  }
  chatSubscriptionHealthy = false;

  messageSubscription = supabase
    .channel(`messages:${convId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${convId}`
    }, async (payload) => {
      chatSubscriptionHealthy = true;
      if (activeConversationId !== convId) return;
      const list = document.getElementById('msg-list');
      const user = getUser();
      const isSent = payload.new.sender_id === user?.id;

      if (list.querySelector('.trusttc-empty-chat')) {
        list.innerHTML = '';
      }

      const msgEl = document.createElement('div');
      msgEl.className = `trusttec-msg ${isSent ? 'sent' : 'received'}`;
      const time = formatTime(payload.new.created_at);
      const safeContent = escapeHtml(payload.new.content);
      if (isSent) {
        msgEl.innerHTML = `<div class="msg-bubble">${safeContent}<span class="trusttec-msg-time">${time}</span></div>`;
      } else {
        let senderName = payload.new.sender_name || 'Inconnu';
        let avatarHtml = payload.new.sender_avatar
          ? `<img class="msg-avatar" src="${payload.new.sender_avatar}" alt="" onerror="this.style.display='none'">`
          : `<div class="msg-avatar msg-avatar-placeholder">${senderName.charAt(0).toUpperCase()}</div>`;

        if (!payload.new.sender_name) {
          if (!profileCache[payload.new.sender_id]) {
            const { data: profile } = await supabase.from('profiles').select('full_name, email, avatar_url').eq('id', payload.new.sender_id).maybeSingle();
            if (profile) profileCache[payload.new.sender_id] = profile;
          }
          const cached = profileCache[payload.new.sender_id];
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
        loadConversations(true);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        chatSubscriptionHealthy = true;
        stopChatPolling();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime messages channel error, starting polling fallback');
        chatSubscriptionHealthy = false;
        startChatPolling();
      }
    });
}

let chatPollingInterval = null;

function stopChatPolling() {
  if (chatPollingInterval) { clearInterval(chatPollingInterval); chatPollingInterval = null; }
}

let globalChatChannel = null;

function setupRealtime() {
  if (!supabase) return;

  const user = getUser();
  const userId = user?.id;

  if (globalChatChannel) {
    supabase.removeChannel(globalChatChannel);
    globalChatChannel = null;
  }

  if (!userId) return;

  globalChatChannel = supabase
    .channel('chat-global')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'conversation_participants',
      filter: `profile_id=eq.${userId}`
    }, () => {
      if (document.getElementById('chat-panel')?.classList.contains('open')) {
        loadConversations(true);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        stopChatPolling();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime chat-global error, starting polling fallback');
        startChatPolling();
      }
    });
}

let lastKnownUserId = null;

onAuthChange((user) => {
  if (!chatInitialized) return;
  const uid = user?.id || null;
  if (uid === lastKnownUserId) return;
  lastKnownUserId = uid;
  setupRealtime();
});

function startChatPolling() {
  if (chatPollingInterval) return;
  chatPollingInterval = setInterval(async () => {
    if (activeConversationId) {
      if (!chatSubscriptionHealthy) {
        await loadMessages(activeConversationId);
        tryResubscribe(activeConversationId);
      }
    }
    if (document.getElementById('chat-panel')?.classList.contains('open')) {
      await loadConversations(true);
    }
  }, 5000);
}

let resubmitAttempts = 0;

function tryResubscribe(convId) {
  resubmitAttempts++;
  if (resubmitAttempts > 6) {
    resubmitAttempts = 0;
    if (messageSubscription) {
      messageSubscription.unsubscribe();
      messageSubscription = null;
    }
    subscribeToMessages(convId);
  }
}

export async function createProductConversation(subject) {
  const user = getUser();
  if (!user || !supabase) return null;

  const lookupSubject = subject || 'Support Trusttec';

  const { data: parts } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('profile_id', user.id)
    .is('deleted_at', null);

  const convIds = (parts || []).map(p => p.conversation_id);

  if (convIds.length > 0) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .in('id', convIds)
      .eq('subject', lookupSubject)
      .maybeSingle();

    if (existing) return existing;
  }

  const { data: convId, error } = await supabase.rpc('create_conv_with_admin', {
    subject: lookupSubject,
    user_id: user.id
  });

  if (error || !convId) return null;

  const { data: conv, error: convErr } = await supabase.from('conversations').select('*').eq('id', convId).maybeSingle();
  if (convErr) {
    console.error('Erreur récupération nouvelle conversation:', convErr);
    return null;
  }
  return conv || null;
}

export function updateUnreadBadge() {
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;
  if (unreadTotal > 0) {
    badge.style.display = 'flex';
    badge.textContent = unreadTotal > 99 ? '99+' : unreadTotal;
  } else {
    badge.style.display = 'none';
  }
}

function resetUnreadBadge() {
  unreadTotal = 0;
  updateUnreadBadge();
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Hier';
  } else if (days < 7) {
    return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  } else {
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
}
