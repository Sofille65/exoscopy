const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = process.env.SETTINGS_PATH || path.join(__dirname, '..', 'data', 'settings.json');

// ─── Defaults — no hardcoded IPs, EXO only ───────────────────
const DEFAULTS = {
  version: '1.6.2',

  // EXO nodes — empty by default, populated via discovery or Settings
  nodes: [],

  // EXO API port (standard exo default)
  exoPort: 52415,

  // Chat endpoint — single EXO engine
  chat: {
    exo1: { name: 'EXO', ip: '', port: 52415 },
  },

  // SSH access to nodes (for download, metrics, sync)
  sshUser: 'admin',
  sshOpts: '-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i /root/.ssh/id_ed25519',

  // OpenRouter (optional cloud fallback)
  openRouterApiKey: '',

  // System prompt
  systemPrompt: '',
  systemPromptEnabled: false,

  // Admin mode (multi-user)
  adminMode: false,
  adminPasswordHash: null,

  // Guest mode (requires adminMode)
  guestMode: false,
  guestTokenLimit: 50000,

  // First-run setup
  setupComplete: false,
};

// ─── Load settings ────────────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
      const saved = JSON.parse(raw);
      const merged = deepMerge(DEFAULTS, saved);
      merged.version = DEFAULTS.version;
      return merged;
    }
  } catch (e) {
    console.error('Failed to load settings, using defaults:', e.message);
  }
  return { ...DEFAULTS };
}

// ─── Save settings ────────────────────────────────────────────
function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  _cache = loadSettings();
  return _cache;
}

// ─── Cache ────────────────────────────────────────────────────
let _cache = null;
function getSettings() {
  if (!_cache) _cache = loadSettings();
  return _cache;
}

// ─── Deep merge ───────────────────────────────────────────────
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = { getSettings, saveSettings, DEFAULTS };
