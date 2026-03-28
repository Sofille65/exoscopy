const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Conversations stored in data/ (Docker volume — persists across rebuilds)
const CONV_PATH = process.env.CONV_PATH || path.join(__dirname, '..', 'data', 'conversations.json');

// In-memory store
let _conversations = null;

// Active inferences — key: conversationId, value: { content, done, error }
const _activeInferences = new Map();

// ─── Load / Save ──────────────────────────────────────────────

function loadConversations() {
  try {
    if (fs.existsSync(CONV_PATH)) {
      const raw = fs.readFileSync(CONV_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[conversations] Failed to load:', e.message);
  }
  return [];
}

function saveConversations() {
  try {
    const dir = path.dirname(CONV_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONV_PATH, JSON.stringify(_conversations, null, 2), 'utf8');
  } catch (e) {
    console.error('[conversations] Failed to save:', e.message);
  }
}

function getConversations() {
  if (!_conversations) _conversations = loadConversations();
  return _conversations;
}

// ─── CRUD ─────────────────────────────────────────────────────

function createConversation({ engine, model, title } = {}) {
  const convs = getConversations();
  const conv = {
    id: crypto.randomUUID(),
    title: title || 'Nouvelle conversation',
    engine: engine || null,
    model: model || null,
    pinned: false,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  convs.unshift(conv);
  saveConversations();
  return conv;
}

function getConversation(id) {
  return getConversations().find(c => c.id === id) || null;
}

function updateConversation(id, updates) {
  const convs = getConversations();
  const idx = convs.findIndex(c => c.id === id);
  if (idx === -1) return null;
  // Only allow safe updates
  const allowed = ['title', 'pinned', 'engine', 'model', 'messages'];
  for (const key of allowed) {
    if (updates[key] !== undefined) convs[idx][key] = updates[key];
  }
  convs[idx].updatedAt = new Date().toISOString();
  saveConversations();
  return convs[idx];
}

function deleteConversation(id) {
  const convs = getConversations();
  const idx = convs.findIndex(c => c.id === id);
  if (idx === -1) return false;
  convs.splice(idx, 1);
  saveConversations();
  // Clean up any active inference
  _activeInferences.delete(id);
  return true;
}

function addMessage(convId, role, content) {
  const conv = getConversation(convId);
  if (!conv) return null;
  conv.messages.push({ role, content, timestamp: new Date().toISOString() });
  conv.updatedAt = new Date().toISOString();
  // Auto-title from first user message
  if (role === 'user' && conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = content.slice(0, 60) + (content.length > 60 ? '…' : '');
  }
  saveConversations();
  return conv;
}

// ─── Active Inferences ────────────────────────────────────────

function startInference(convId) {
  _activeInferences.set(convId, { content: '', done: false, error: null });
}

function appendInferenceContent(convId, chunk) {
  const inf = _activeInferences.get(convId);
  if (inf) inf.content += chunk;
}

function finishInference(convId, error = null) {
  const inf = _activeInferences.get(convId);
  if (!inf) return;
  inf.done = true;
  inf.error = error;
  // Save final assistant message to conversation
  if (inf.content && !error) {
    addMessage(convId, 'assistant', inf.content);
  }
}

function getInferenceStatus(convId) {
  const inf = _activeInferences.get(convId);
  if (!inf) return { active: false };
  return { active: !inf.done, content: inf.content, done: inf.done, error: inf.error };
}

function clearInference(convId) {
  _activeInferences.delete(convId);
}

// ─── List (sorted: pinned first, then by updatedAt) ───────────

function listConversations() {
  const convs = getConversations();
  // Return lightweight list (without full messages)
  return convs
    .map(c => ({
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      engine: c.engine,
      model: c.model,
      messageCount: c.messages.length,
      lastMessage: c.messages.length > 0 ? c.messages[c.messages.length - 1].content.slice(0, 80) : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  startInference,
  appendInferenceContent,
  finishInference,
  getInferenceStatus,
  clearInference,
};
