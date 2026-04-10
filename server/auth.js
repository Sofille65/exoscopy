const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const USERS_PATH = path.join(__dirname, '..', 'data', 'users.json');
const SECRET_PATH = path.join(__dirname, '..', 'data', 'session-secret.txt');
const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Session Secret ──────────────────────────────────────────

function getSessionSecret() {
  try {
    if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  } catch (e) {}
  const secret = crypto.randomBytes(32).toString('hex');
  const dir = path.dirname(SECRET_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, 'utf8');
  return secret;
}

// ─── Users CRUD ──────────────────────────────────────────────

function loadUsers() {
  try {
    if (fs.existsSync(USERS_PATH)) return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (e) { console.error('[auth] Failed to load users:', e.message); }
  return [];
}

function saveUsers(users) {
  const dir = path.dirname(USERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
}

function getUser(username) {
  return loadUsers().find(u => u.username === username) || null;
}

function createUser(username, password, role = 'user') {
  const users = loadUsers();
  if (users.find(u => u.username === username)) return null; // already exists
  const user = {
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    active: true,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  // Create user data directory
  const userDir = path.join(DATA_DIR, 'users', username);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  return { username: user.username, role: user.role, active: user.active, createdAt: user.createdAt };
}

function updateUser(username, updates) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return null;
  if (updates.password) users[idx].passwordHash = bcrypt.hashSync(updates.password, 10);
  if (updates.active !== undefined) users[idx].active = updates.active;
  if (updates.role && username !== 'admin') users[idx].role = updates.role; // can't change admin role
  saveUsers(users);
  return { username: users[idx].username, role: users[idx].role, active: users[idx].active };
}

function deleteUser(username) {
  if (username === 'admin') return false; // can't delete admin
  const users = loadUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return false;
  users.splice(idx, 1);
  saveUsers(users);
  return true;
}

function listUsers() {
  return loadUsers().map(u => ({
    username: u.username, role: u.role, active: u.active, createdAt: u.createdAt,
  }));
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// ─── Admin bootstrap ─────────────────────────────────────────

function ensureAdminUser(password) {
  const users = loadUsers();
  const existing = users.find(u => u.username === 'admin');
  const hash = bcrypt.hashSync(password, 10);
  if (existing) {
    existing.passwordHash = hash;
    existing.role = 'admin';
    existing.active = true;
    saveUsers(users);
  } else {
    createUser('admin', password, 'admin');
  }
}

// ─── Middleware ───────────────────────────────────────────────

function authMiddleware(getSettings) {
  return (req, res, next) => {
    const settings = getSettings();
    if (!settings.adminMode) {
      req.user = null; // no auth
      return next();
    }
    // Public routes — no auth required
    const publicPaths = ['/api/auth/status', '/api/auth/login'];
    if (publicPaths.includes(req.path)) return next();
    // Static files
    if (!req.path.startsWith('/api/')) return next();

    if (req.session && req.session.username) {
      const user = getUser(req.session.username);
      if (user && user.active) {
        req.user = { username: user.username, role: user.role };
        return next();
      }
    }
    return res.status(401).json({ error: 'Not authenticated' });
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    // When adminMode is off (req.user is null and no session), pass through
    if (req.user === null && !(req.session && req.session.username)) return next();
    if (req.user && roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

// ─── Data migration ──────────────────────────────────────────

function migrateToAdminMode() {
  const adminDir = path.join(DATA_DIR, 'users', 'admin');
  if (!fs.existsSync(adminDir)) fs.mkdirSync(adminDir, { recursive: true });

  // Migrate conversations
  const globalConv = path.join(DATA_DIR, 'conversations.json');
  const adminConv = path.join(adminDir, 'conversations.json');
  if (fs.existsSync(globalConv) && !fs.existsSync(adminConv)) {
    fs.copyFileSync(globalConv, adminConv);
    console.log('[auth] Migrated conversations to admin user');
  }
}

module.exports = {
  getSessionSecret,
  getUser, createUser, updateUser, deleteUser, listUsers,
  verifyPassword, ensureAdminUser, migrateToAdminMode,
  authMiddleware, requireRole,
};
