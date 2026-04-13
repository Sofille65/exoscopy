'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// ExoScopy — EXO Cluster Management Dashboard
// Public-facing fork of Model Manager, EXO-only.
// Port 3456
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');
const { exec, spawn } = require('child_process');
const fs       = require('fs');
const net      = require('net');
const os       = require('os');

const cookieSession = require('cookie-session');

const { getSettings, saveSettings } = require('./settings');
const { scanAllNodes }                          = require('./scanner');
const {
  createConversationStore,
  startInference, appendInferenceContent, finishInference,
  getInferenceStatus, clearInference,
} = require('./conversations');
const {
  getSessionSecret, getUser, createUser, updateUser, deleteUser, listUsers,
  verifyPassword, ensureAdminUser, migrateToAdminMode,
  authMiddleware, requireRole,
  logAuthEvent, getAuthLog, clearAuthLog,
} = require('./auth');
const { createProjectStore, CATEGORIES: PROJECT_CATEGORIES } = require('./projects');

// ─── Express + Socket.IO bootstrap ───────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(cookieSession({ name: 'exoscopy', keys: [getSessionSecret()], maxAge: 24 * 60 * 60 * 1000 }));
app.use(authMiddleware(getSettings));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/plugins', express.static(path.join(__dirname, '..', 'plugins')));

const PORT = 3456;
const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── User-scoped conversation stores ─────────────────────────────────────────

const defaultConvStore = createConversationStore(path.join(DATA_DIR, 'conversations.json'));
const _userStores = {};

function getConvStore(req) {
  const settings = getSettings();
  if (settings.adminMode && req.user) {
    const username = req.user.username;
    if (!_userStores[username]) {
      const userDir = path.join(DATA_DIR, 'users', username);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      _userStores[username] = createConversationStore(path.join(userDir, 'conversations.json'));
    }
    return _userStores[username];
  }
  return defaultConvStore;
}

// ─── User-scoped project stores ──────────────────────────────────────────────

const defaultProjStore = createProjectStore(path.join(DATA_DIR, 'projects.json'));
const _userProjStores = {};

function getProjStore(req) {
  const settings = getSettings();
  if (settings.adminMode && req.user) {
    const username = req.user.username;
    if (!_userProjStores[username]) {
      const userDir = path.join(DATA_DIR, 'users', username);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      _userProjStores[username] = createProjectStore(path.join(userDir, 'projects.json'));
    }
    return _userProjStores[username];
  }
  return defaultProjStore;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/settings — return current settings (strip sensitive fields for non-admin)
app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  // Don't expose password hash or OpenRouter key to regular users
  if (settings.adminMode && req.user?.role !== 'admin') {
    const { adminPasswordHash, openRouterApiKey, ...safe } = settings;
    return res.json(safe);
  }
  res.json(settings);
});

// PUT /api/settings — update settings (partial merge, admin only when adminMode is on)
app.put('/api/settings', (req, res) => {
  try {
    const current = getSettings();
    const update  = req.body;

    // When adminMode is already on, only admin can change settings
    if (current.adminMode && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    // Handle admin mode activation
    if (update.adminMode === true && !current.adminMode) {
      if (!update.adminPassword) {
        return res.status(400).json({ error: 'adminPassword required to enable admin mode' });
      }
      ensureAdminUser(update.adminPassword);
      migrateToAdminMode();
      delete update.adminPassword;
    }

    // Handle admin mode deactivation
    if (update.adminMode === false && current.adminMode) {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can disable admin mode' });
      }
      delete update.adminPassword;
    }

    // Validate nodes array (0-10 elements, each needs name + ip)
    if (update.nodes) {
      if (!Array.isArray(update.nodes) || update.nodes.length > 10) {
        return res.status(400).json({ error: 'nodes must be an array of 0-10 elements' });
      }
      for (const n of update.nodes) {
        if (!n.name || !n.ip) {
          return res.status(400).json({ error: 'Each node needs name and ip' });
        }
        if (!n.paths) n.paths = { exo: '~/.exo/models' };
        if (!n.paths.exo) n.paths.exo = '~/.exo/models';
      }
    }

    const merged = { ...current, ...update };
    const saved  = saveSettings(merged);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/auth/status — public, returns whether admin mode is active
app.get('/api/auth/status', (req, res) => {
  const settings = getSettings();
  res.json({ adminMode: !!settings.adminMode, guestMode: !!(settings.adminMode && settings.guestMode) });
});

// POST /api/auth/login — public, authenticate user
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const user = getUser(username);
  if (!user || !user.active) {
    logAuthEvent('login_failed', username, clientIp);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    logAuthEvent('login_failed', username, clientIp);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.username = user.username;
  logAuthEvent('login', user.username, clientIp, { role: user.role });
  res.json({ username: user.username, role: user.role });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const who = req.session?.username || (req.session?.guest ? 'guest' : 'unknown');
  logAuthEvent('logout', who, clientIp);
  req.session = null;
  res.json({ ok: true });
});

// POST /api/auth/guest — start a guest session
app.post('/api/auth/guest', (req, res) => {
  const settings = getSettings();
  if (!settings.adminMode || !settings.guestMode) {
    return res.status(403).json({ error: 'Guest mode not available' });
  }
  req.session.guest = true;
  req.session.guestTokensUsed = 0;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logAuthEvent('guest', 'guest', clientIp);
  res.json({ username: 'guest', role: 'guest', tokensUsed: 0, tokenLimit: settings.guestTokenLimit });
});

// GET /api/auth/me — returns current user info
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const result = { username: req.user.username, role: req.user.role };
  if (req.user.role === 'guest') {
    const settings = getSettings();
    result.tokensUsed = req.session.guestTokensUsed || 0;
    result.tokenLimit = settings.guestTokenLimit;
  }
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — USER MANAGEMENT API
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireRole('admin'), (req, res) => {
  res.json(listUsers());
});

app.post('/api/admin/users', requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (username.length < 2 || username.length > 30) return res.status(400).json({ error: 'username must be 2-30 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' });
  const user = createUser(username, password, role || 'user');
  if (!user) return res.status(409).json({ error: 'User already exists' });
  res.json(user);
});

app.put('/api/admin/users/:username', requireRole('admin'), (req, res) => {
  const updated = updateUser(req.params.username, req.body);
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json(updated);
});

app.delete('/api/admin/users/:username', requireRole('admin'), (req, res) => {
  const ok = deleteUser(req.params.username);
  if (!ok) return res.status(400).json({ error: 'Cannot delete this user' });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — AUTH LOG API
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/admin/auth-log', requireRole('admin'), (req, res) => {
  res.json(getAuthLog());
});

app.delete('/api/admin/auth-log', requireRole('admin'), (req, res) => {
  clearAuthLog();
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENTS API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/environments — always returns ['exo'] for ExoScopy
app.get('/api/environments', (req, res) => {
  res.json({ active: ['exo'], current: 'exo' });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/state — EXO node models (disk scan)
app.get('/api/state', async (req, res) => {
  try {
    const nodes = await scanAllNodes('exo');
    res.json({ environment: 'exo', nodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes — EXO nodes with disk scan
app.get('/api/nodes', async (req, res) => {
  try {
    const nodes = await scanAllNodes('exo');
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SSH HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a bash command on a remote host via SSH.
 * The command is written to stdin to avoid shell-quoting hazards.
 * @param {string} ip
 * @param {string} cmd - bash script to execute
 * @param {number} [timeout=8000] - ms
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, error?: string}>}
 */
function sshExec(ip, cmd, timeout = 8000) {
  const settings = getSettings();
  const { sshUser, sshOpts } = settings;
  return new Promise((resolve) => {
    const child = exec(
      `ssh ${sshOpts} ${sshUser}@${ip} bash -s`,
      { timeout, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: err.message, stderr, stdout: '' });
        else     resolve({ ok: true,  stdout: stdout.trim(), stderr: stderr.trim() });
      }
    );
    child.stdin.write(cmd);
    child.stdin.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MONITORING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Return the EXO nodes from settings (filtered by exoNodes list). */
function getExoNodes() {
  const settings     = getSettings();
  const exoNodeNames = settings.exoNodes || settings.nodes.map(n => n.name);
  return settings.nodes.filter(n => exoNodeNames.includes(n.name));
}

/** Return the base URL of the EXO dashboard (first EXO node, port 52415). */
function getDashboardURL() {
  const nodes = getExoNodes();
  return `http://${nodes[0]?.ip || '127.0.0.1'}:52415`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONITORING API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/monitoring/status — node reachability + active EXO instances
// Uses HTTP probes to exo API (no SSH required)
app.get('/api/monitoring/status', async (req, res) => {
  const nodes = getExoNodes();
  const exoPort = getSettings().exoPort || 52415;

  // Check each node by probing its exo API via HTTP
  const nodeStatuses = await Promise.all(nodes.map(async (node) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(`http://${node.ip}:${exoPort}/v1/models`, { signal: controller.signal });
      clearTimeout(timer);
      return {
        name: node.name, ip: node.ip, ram: node.ram,
        online: true, processRunning: r.ok, exoRunning: r.ok,
      };
    } catch (e) {
      return {
        name: node.name, ip: node.ip, ram: node.ram,
        online: false, processRunning: false, exoRunning: false,
      };
    }
  }));

  // Query EXO /state for loaded instances (direct HTTP, not SSH)
  let instances = [];
  try {
    const firstOnline = nodeStatuses.find(n => n.online);
    if (firstOnline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(`http://${firstOnline.ip}:${exoPort}/state`, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const state = await r.json();
        const insts = state.instances || {};
        instances = Object.entries(insts).map(([id, info]) => {
          let model      = 'unknown';
          let baseModel  = null;
          let shardCount = 0;

          const wrapperKey = Object.keys(info).find(k => k.endsWith('Instance'));
          const inner      = wrapperKey ? info[wrapperKey] : info;

          if (inner.shardAssignments?.modelId) {
            model = inner.shardAssignments.modelId;
            const runners = inner.shardAssignments.runnerToShard;
            if (runners) {
              shardCount        = Object.keys(runners).length;
              const firstShard  = Object.values(runners)[0];
              const meta        = firstShard?.PipelineShardMetadata || firstShard;
              if (meta?.modelCard?.baseModel) baseModel = meta.modelCard.baseModel;
            }
          }

          if (model === 'unknown') {
            model = inner.model_id || inner.model || inner.model_name
                 || info.model_id  || info.model  || 'unknown';
          }

          if (model === 'unknown') {
            const flat  = JSON.stringify(info);
            const match = flat.match(/mlx-community\/[^"]+|"modelId"\s*:\s*"([^"]+)"/);
            if (match) model = match[1] || match[0];
          }

          return { id, model, baseModel, shardCount };
        });
      }
    }
  } catch (e) {
    console.log('[monitoring] EXO /state parse error:', e.message);
  }

  res.json({
    env:          'exo',
    nodes:        nodeStatuses,
    activeCount:  nodeStatuses.filter(n => n.processRunning).length,
    totalCount:   nodes.length,
    instances,
    dashboardURL: getDashboardURL(),
  });
});

// GET /api/monitoring/ram — RAM usage per EXO node (pure shell, no Python)
app.get('/api/monitoring/ram', async (req, res) => {
  const nodes = getExoNodes();

  const ramData = await Promise.all(nodes.map(async (node) => {
    const cmd = `
TOTAL_BYTES=$(sysctl -n hw.memsize)
TOTAL_GB=$(echo "$TOTAL_BYTES / 1073741824" | bc)
PAGE_SIZE=$(vm_stat | head -1 | awk -F'page size of ' '{print $2}' | awk '{print $1}')
ACTIVE=$(vm_stat | awk '/Pages active/ {gsub(/\\./, "", $3); print $3}')
WIRED=$(vm_stat | awk '/Pages wired/ {gsub(/\\./, "", $4); print $4}')
COMPRESSED=$(vm_stat | awk '/Pages occupied by compressor/ {gsub(/\\./, "", $5); print $5}')
USED_BYTES=$(echo "($ACTIVE + $WIRED + $COMPRESSED) * $PAGE_SIZE" | bc)
USED_GB=$(echo "scale=1; $USED_BYTES / 1073741824" | bc)
FREE_GB=$(echo "scale=1; $TOTAL_GB - $USED_GB" | bc)
PCT=$(echo "scale=0; $USED_GB * 100 / $TOTAL_GB" | bc)
echo "{\\"total\\":$TOTAL_GB,\\"used\\":$USED_GB,\\"free\\":$FREE_GB,\\"percent\\":$PCT}"
`;
    const r = await sshExec(node.ip, cmd, 10000);

    if (r.ok) {
      try {
        const data = JSON.parse(r.stdout);
        return { name: node.name, ip: node.ip, ...data, online: true };
      } catch (e) {
        console.log('[monitoring] RAM parse error for', node.name, ':', r.stdout);
        return { name: node.name, ip: node.ip, online: true, error: 'parse error' };
      }
    }
    return { name: node.name, ip: node.ip, online: false, error: r.error || 'unreachable' };
  }));

  res.json(ramData);
});

// GET /api/monitoring/info/:name — detailed machine info for a single node
app.get('/api/monitoring/info/:name', async (req, res) => {
  const settings = getSettings();
  const node     = settings.nodes.find(n => n.name === req.params.name);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const [osVer, chip, ram, hostname, uptime] = await Promise.all([
    sshExec(node.ip, 'sw_vers -productVersion', 5000),
    sshExec(node.ip, 'sysctl -n machdep.cpu.brand_string 2>/dev/null || echo N/A', 5000),
    sshExec(node.ip, `sysctl -n hw.memsize | awk '{printf "%.0f Go", $1/1073741824}'`, 5000),
    sshExec(node.ip, 'hostname', 5000),
    sshExec(node.ip, `uptime | sed 's/.*up /up /' | sed 's/,.*//'`, 5000),
  ]);

  res.json({
    name:     node.name,
    ip:       node.ip,
    macOS:    osVer.ok    ? osVer.stdout    : 'N/A',
    chip:     chip.ok     ? chip.stdout     : 'N/A',
    ram:      ram.ok      ? ram.stdout      : (node.ram || 'N/A'),
    hostname: hostname.ok ? hostname.stdout : 'N/A',
    uptime:   uptime.ok   ? uptime.stdout   : 'N/A',
  });
});

// POST /api/monitoring/start — launch EXO app on target nodes
// body: { nodes?: string[] }  (omit for all EXO nodes)
app.post('/api/monitoring/start', async (req, res) => {
  const nodes       = getExoNodes();
  const targetNames = req.body.nodes || nodes.map(n => n.name);
  const results     = [];

  for (const name of targetNames) {
    const node = nodes.find(n => n.name === name);
    if (!node) { results.push({ name, ok: false, error: 'Unknown node' }); continue; }
    const r = await sshExec(node.ip, 'open -a "EXO"', 10000);
    results.push({ name, ip: node.ip, ok: r.ok, error: r.ok ? null : r.error });
  }

  res.json({ results });
});

// POST /api/monitoring/stop — kill EXO process on target nodes
// body: { nodes?: string[] }
app.post('/api/monitoring/stop', async (req, res) => {
  const nodes       = getExoNodes();
  const targetNames = req.body.nodes || nodes.map(n => n.name);
  const results     = [];

  for (const name of targetNames) {
    const node = nodes.find(n => n.name === name);
    if (!node) { results.push({ name, ok: false, error: 'Unknown node' }); continue; }
    const r = await sshExec(node.ip, 'pkill -f EXO 2>/dev/null; echo DONE', 10000);
    results.push({ name, ip: node.ip, ok: r.ok, error: r.ok ? null : r.error });
  }

  res.json({ results });
});

// POST /api/monitoring/purge — delete all EXO instances via DELETE /instance/:id (admin/organizer only)
app.post('/api/monitoring/purge', requireRole('admin', 'organizer'), async (req, res) => {
  const nodes     = getExoNodes();
  const firstNode = nodes[0];
  if (!firstNode) return res.json({ purged: 0, error: 'No EXO nodes configured' });
  const exoPort = getSettings().exoPort || 52415;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const stateR = await fetch(`http://${firstNode.ip}:${exoPort}/state`, { signal: controller.signal });
    clearTimeout(timer);
    if (!stateR.ok) return res.json({ purged: 0, error: 'Cluster unreachable' });

    const stateResult = await stateR.json();
    if (!stateResult.instances) return res.json({ purged: 0, error: 'No instances found' });

    const instanceIds = Object.keys(stateResult.instances);
    const results = [];

    for (const iid of instanceIds) {
      try {
        const r = await fetch(`http://${firstNode.ip}:${exoPort}/instance/${iid}`, { method: 'DELETE' });
        results.push({ id: iid, ok: r.ok });
      } catch (e) {
        results.push({ id: iid, ok: false });
      }
    }

    res.json({ purged: results.filter(r => r.ok).length, total: instanceIds.length, results });
  } catch (e) {
    res.json({ purged: 0, error: e.message });
  }
});

// GET /api/monitoring/exo-node-metrics — GPU%, temp, watts per node from EXO /state
app.get('/api/monitoring/exo-node-metrics', async (req, res) => {
  const settings     = getSettings();
  const exoPort      = settings.exoPort || 52415;
  const exoNodeNames = settings.exoNodes || settings.nodes.map(n => n.name);
  const firstNode    = settings.nodes.find(n => exoNodeNames.includes(n.name));
  if (!firstNode) return res.json({ nodes: [] });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`http://${firstNode.ip}:${exoPort}/state`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.json({ nodes: [] });

    const state = await r.json();
    const { nodeSystem, nodeMemory, nodeNetwork } = state;
    if (!nodeSystem || !nodeNetwork) return res.json({ nodes: [] });

    // Build IP → node name map from settings
    const ipToName = {};
    for (const n of settings.nodes) ipToName[n.ip] = n.name;

    // Map peer ID → node name via network interfaces
    const peerToName = {};
    for (const [peerId, netData] of Object.entries(nodeNetwork)) {
      const iface = (netData.interfaces || []).find(i => i.ipAddress && ipToName[i.ipAddress]);
      if (iface) peerToName[peerId] = ipToName[iface.ipAddress];
    }

    const nodes = [];
    for (const [peerId, sys] of Object.entries(nodeSystem)) {
      const name = peerToName[peerId];
      if (!name || !exoNodeNames.includes(name)) continue;

      const mem    = nodeMemory?.[peerId];
      let ramPct   = null;
      if (mem?.ramTotal?.inBytes && mem?.ramAvailable?.inBytes) {
        ramPct = Math.round(
          (mem.ramTotal.inBytes - mem.ramAvailable.inBytes) / mem.ramTotal.inBytes * 100
        );
      }

      nodes.push({
        name,
        gpuPct: sys.gpuUsage != null ? Math.round(sys.gpuUsage * 100) : null,
        tempC:  sys.temp     != null ? Math.round(sys.temp)           : null,
        watts:  sys.sysPower != null ? Math.round(sys.sysPower)       : null,
        ramPct,
      });
    }

    res.json({ nodes });
  } catch (e) {
    res.status(500).json({ error: e.message, nodes: [] });
  }
});

// GET /api/models/matrix — models per node (from /state DownloadCompleted, no SSH)
app.get('/api/models/matrix', async (req, res) => {
  const settings = getSettings();
  const exoPort = settings.exoPort || 52415;
  const firstNode = settings.nodes[0];
  if (!firstNode) return res.json({ nodes: [], models: [], matrix: {} });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(`http://${firstNode.ip}:${exoPort}/state`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.json({ nodes: [], models: [], matrix: {} });
    const state = await r.json();

    const downloads = state.downloads || {};
    const nodeNetwork = state.nodeNetwork || {};

    // Map peerId → IP via network interfaces
    const peerToIp = {};
    for (const [peerId, netData] of Object.entries(nodeNetwork)) {
      for (const iface of (netData.interfaces || [])) {
        if (iface.ipAddress) {
          const matchNode = settings.nodes.find(n => n.ip === iface.ipAddress);
          if (matchNode) peerToIp[peerId] = iface.ipAddress;
        }
      }
    }

    // Map IP → node name
    const ipToName = {};
    for (const n of settings.nodes) ipToName[n.ip] = n.name;

    // Build models per node
    const nodeModels = {}; // nodeName → [{ id, sizeGB }]
    for (const [peerId, nodeDownloads] of Object.entries(downloads)) {
      const ip = peerToIp[peerId];
      const name = ip ? (ipToName[ip] || ip) : null;
      if (!name) continue;
      if (!nodeModels[name]) nodeModels[name] = [];
      for (const entry of nodeDownloads) {
        if (entry.DownloadCompleted) {
          const meta = entry.DownloadCompleted.shardMetadata;
          const modelId = meta?.PipelineShardMetadata?.modelCard?.modelId
                       || meta?.TensorShardMetadata?.modelCard?.modelId;
          const sizeBytes = meta?.PipelineShardMetadata?.modelCard?.storageSize?.inBytes
                         || meta?.TensorShardMetadata?.modelCard?.storageSize?.inBytes || 0;
          if (modelId && !deletedModels.has(`${modelId}::${name}`)) {
            nodeModels[name].push({ id: modelId, sizeBytes: sizeBytes || 0 });
          }
        }
      }
    }

    // Build unique sorted model list
    const allModels = new Map();
    for (const models of Object.values(nodeModels)) {
      for (const m of models) {
        if (!allModels.has(m.id)) allModels.set(m.id, m.sizeBytes);
      }
    }
    const modelList = [...allModels.entries()]
      .map(([id, sizeBytes]) => ({ id, sizeBytes }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);

    // Get active model
    let activeModel = null;
    const instances = state.instances || {};
    for (const inst of Object.values(instances)) {
      const wrapperKey = Object.keys(inst).find(k => k.endsWith('Instance'));
      const inner = wrapperKey ? inst[wrapperKey] : inst;
      if (inner?.shardAssignments?.modelId) { activeModel = inner.shardAssignments.modelId; break; }
    }

    // Get disk info per node
    const nodeDisk = state.nodeDisk || {};
    const diskInfo = {};
    for (const [peerId, disk] of Object.entries(nodeDisk)) {
      const ip = peerToIp[peerId];
      const name = ip ? (ipToName[ip] || ip) : null;
      if (name && disk.available) {
        diskInfo[name] = {
          freeGB: Math.round(disk.available.inBytes / 1073741824),
          totalGB: disk.total ? Math.round(disk.total.inBytes / 1073741824) : null,
        };
      }
    }

    res.json({
      nodes: settings.nodes.map(n => n.name),
      models: modelList,
      matrix: nodeModels,
      activeModel,
      diskInfo,
    });
  } catch (e) {
    res.status(500).json({ error: e.message, nodes: [], models: [], matrix: {} });
  }
});

// GET /api/monitoring/exo-models — models available via exo API (HTTP, no SSH scan)
app.get('/api/monitoring/exo-models', async (req, res) => {
  const settings = getSettings();
  const exoPort  = settings.exoPort || 52415;
  const firstNode = settings.nodes[0];
  if (!firstNode) return res.json({ models: [] });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`http://${firstNode.ip}:${exoPort}/v1/models`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.json({ models: [] });
    const data = await r.json();
    const models = (data.data || []).map(m => m.id).sort();
    res.json({ models, nodeCount: settings.nodes.length });
  } catch (e) {
    res.status(500).json({ error: e.message, models: [] });
  }
});

// GET /api/monitoring/exo-load-status — poll exo /state for real model loading status
app.get('/api/monitoring/exo-load-status', async (req, res) => {
  const nodes = getExoNodes();
  const firstNode = nodes[0];
  if (!firstNode) return res.json({ status: 'idle', model: null });
  const exoPort = getSettings().exoPort || 52415;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const r = await fetch(`http://${firstNode.ip}:${exoPort}/state`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await r.json();

    // Find active instance and model
    let activeModel = null;
    let instanceId = null;
    for (const [iid, inst] of Object.entries(data.instances || {})) {
      const inner = inst.MlxJacclInstance || inst.MlxRingInstance || inst.MlxInstance || Object.values(inst)[0];
      const modelId = inner?.shardAssignments?.modelId;
      if (modelId) { activeModel = modelId; instanceId = iid; break; }
    }
    if (!activeModel) return res.json({ status: 'idle', model: null });

    // Count runners for this instance
    const runners = data.runners || {};
    let readyCount = 0;
    let totalCount = 0;
    for (const runner of Object.values(runners)) {
      if (runner.RunnerReady) readyCount++;
      if (!runner.RunnerShuttingDown) totalCount++;
    }

    // Check if there are still-running CreateRunner tasks for this instance
    let loadingTasks = 0;
    for (const task of Object.values(data.tasks || {})) {
      const cr = task.CreateRunner;
      if (cr && cr.instanceId === instanceId && cr.taskStatus === 'Running') loadingTasks++;
    }

    let status;
    if (loadingTasks > 0) {
      status = 'loading';
    } else if (readyCount > 0 && readyCount >= totalCount) {
      status = 'running';
    } else if (readyCount > 0) {
      status = 'warming';
    } else {
      status = 'loading';
    }

    res.json({ status, model: activeModel, instanceId, readyRunners: readyCount, totalRunners: totalCount, loadingTasks });
  } catch (e) {
    res.json({ status: 'idle', model: null });
  }
});

// POST /api/monitoring/load — load a model on the EXO cluster via place_instance
// body: { modelId, sharding?, minNodes? }
app.post('/api/monitoring/load', requireRole('admin', 'organizer'), async (req, res) => {
  const nodes     = getExoNodes();
  const firstNode = nodes[0];
  if (!firstNode) return res.status(400).json({ error: 'No EXO nodes configured' });
  const exoPort = getSettings().exoPort || 52415;

  const { modelId, sharding = 'Tensor', minNodes = 4 } = req.body;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });

  try {
    const r = await fetch(`http://${firstNode.ip}:${exoPort}/place_instance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, sharding, instance_meta: 'MlxJaccl', min_nodes: minNodes }),
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load model' });
  }
});

// DELETE /api/monitoring/instance/:instanceId — unload a specific EXO instance (admin/organizer only)
app.delete('/api/monitoring/instance/:instanceId', requireRole('admin', 'organizer'), async (req, res) => {
  const nodes     = getExoNodes();
  const firstNode = nodes[0];
  if (!firstNode) return res.status(400).json({ error: 'No EXO nodes configured' });
  const exoPort = getSettings().exoPort || 52415;

  const { instanceId } = req.params;
  try {
    const r = await fetch(`http://${firstNode.ip}:${exoPort}/instance/${instanceId}`, { method: 'DELETE' });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to delete instance' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD API (HuggingFace, queue-aware)
// ─────────────────────────────────────────────────────────────────────────────

const DOWNLOADS_PATH        = path.join(__dirname, '..', 'data', 'downloads.json');
const MAX_CONCURRENT_DOWNLOADS = 3;
const activeDownloads       = {};   // id → download record
const downloadQueue         = [];   // [{ modelId, queueId }]

function getActiveDownloadCount() {
  return Object.values(activeDownloads).filter(d => d.status === 'downloading').length;
}

/** Drain the queue: start downloads until MAX_CONCURRENT_DOWNLOADS is reached. */
function processQueue() {
  while (getActiveDownloadCount() < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const next = downloadQueue.shift();
    _startDownload(next.modelId, next.queueId);
    io.emit('download:progress', { id: next.queueId, modelId: next.modelId, progress: null, status: 'downloading' });
  }
  // Emit updated queue positions for remaining items
  downloadQueue.forEach((item, i) => {
    if (activeDownloads[item.queueId]) activeDownloads[item.queueId].queuePosition = i + 1;
    io.emit('download:queued', { id: item.queueId, position: i + 1 });
  });
}

/** Persist activeDownloads to disk (strip non-serialisable fields). */
function saveDownloads() {
  try {
    const dir = path.dirname(DOWNLOADS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const list = Object.values(activeDownloads).map(({ _child, lastStderr, ...rest }) => rest);
    fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('[downloads] Failed to save:', e.message);
  }
}

/** Load persisted downloads on startup; reset transient statuses. */
function loadDownloads() {
  try {
    if (fs.existsSync(DOWNLOADS_PATH)) {
      const saved = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf8'));
      for (const dl of saved) {
        if (dl.status === 'downloading' || dl.status === 'queued') dl.status = 'stopped';
        dl._child = null;
        activeDownloads[dl.id] = dl;
      }
      console.log(`[downloads] Restored ${saved.length} downloads from disk`);
    }
  } catch (e) {
    console.error('[downloads] Failed to load:', e.message);
  }
}

loadDownloads();

/**
 * Queue-aware entry point for starting a download.
 * Returns the download ID (may be queued if slots are full).
 */
function startDownload(modelId) {
  if (getActiveDownloadCount() >= MAX_CONCURRENT_DOWNLOADS) {
    const queueId = `dl-${Date.now()}`;
    activeDownloads[queueId] = {
      id: queueId, modelId, status: 'queued',
      queuePosition: downloadQueue.length + 1,
      startedAt: new Date().toISOString(),
      progress: null, error: null, _child: null,
    };
    downloadQueue.push({ modelId, queueId });
    saveDownloads();
    io.emit('download:queued', { id: queueId, modelId, position: downloadQueue.length });
    return queueId;
  }
  return _startDownload(modelId);
}

/**
 * Internal: spawn the SSH/Python download process.
 * @param {string} modelId - HuggingFace repo id (community/model-name)
 * @param {string} [existingId] - reuse this id (for queue promotion / restart)
 */
function _startDownload(modelId, existingId) {
  const settings   = getSettings();
  const firstNode  = settings.nodes[0];
  if (!firstNode) { console.error('[download] No nodes configured'); return existingId || `dl-err-${Date.now()}`; }
  const sshUser    = settings.sshUser || 'admin';
  const sourceIp   = firstNode.ip;
  const sshOpts    = settings.sshOpts;
  const destPath   = '~/.exo/models';
  const downloadId = existingId || `dl-${Date.now()}`;

  if (existingId && activeDownloads[existingId]) {
    activeDownloads[existingId].status       = 'downloading';
    activeDownloads[existingId].startedAt    = new Date().toISOString();
    activeDownloads[existingId].queuePosition = null;
  } else {
    activeDownloads[downloadId] = {
      id: downloadId, modelId, status: 'downloading',
      startedAt: new Date().toISOString(),
      progress: null, error: null, _child: null,
    };
  }
  saveDownloads();

  // EXO uses flat dir names with '--' separator: mlx-community/Qwen → mlx-community--Qwen
  const localDir     = `${destPath}/${modelId.replace('/', '--')}`;
  const cleanLocks   = `find '${localDir}' -name '*.lock' -delete 2>/dev/null`;

  // Python download script — monitors disk usage for progress reporting
  const pyScript = `
import threading, time, os, sys
from huggingface_hub import snapshot_download, HfApi
repo="${modelId}"
dest=os.path.expanduser("${localDir}")
total_bytes=0
try:
    api=HfApi()
    info=api.repo_info(repo, files_metadata=True)
    total_bytes=sum(getattr(s,'size',0) or 0 for s in info.siblings)
except Exception as ex:
    print(f"TOTALERR:{ex}",flush=True)
total_gb=round(total_bytes/1073741824,1) if total_bytes else 0
print(f"TOTAL:{total_gb}",flush=True)
done=False
error=None
prev_sz=0
prev_t=time.time()
def dl():
    global done, error
    try:
        snapshot_download(repo, local_dir=dest)
    except Exception as e:
        error=str(e)
    finally:
        done=True
t=threading.Thread(target=dl)
t.start()
while not done:
    time.sleep(3)
    sz=0
    for r,ds,fs in os.walk(dest):
        for f in fs:
            try: sz+=os.path.getsize(os.path.join(r,f))
            except: pass
    now=time.time()
    dt=now-prev_t
    speed_mb=round((sz-prev_sz)/1048576/dt,1) if dt>0 else 0
    prev_sz=sz
    prev_t=now
    inc=len([f for r,ds,fs in os.walk(dest) for f in fs if f.endswith(".incomplete")])
    gb=round(sz/1073741824,1)
    print(f"PROGRESS:{gb}:{total_gb}:{inc}:{speed_mb}",flush=True)
t.join()
if error:
    print(f"ERROR:{error}",flush=True)
    sys.exit(1)
print("DONE",flush=True)
`.trim();

  const sshArgs = sshOpts.split(/\s+/).concat([
    `${sshUser}@${sourceIp}`,
    `${cleanLocks}; python3 -u -`,
  ]);
  const child = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(pyScript);
  child.stdin.end();
  activeDownloads[downloadId]._child = child;

  child.stdout.on('data', (buf) => {
    const dl    = activeDownloads[downloadId];
    if (!dl) return;
    const lines = buf.toString().trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('PROGRESS:')) {
        dl.progress = line.slice(9);
        io.emit('download:progress', { id: downloadId, modelId, progress: dl.progress });
      } else if (line.startsWith('ERROR:')) {
        dl.error = line.slice(6);
      }
    }
  });

  child.stderr.on('data', (buf) => {
    const dl = activeDownloads[downloadId];
    if (dl) {
      dl.lastStderr = ((dl.lastStderr || '') + buf.toString()).slice(-2048);
    }
  });

  child.on('close', (code) => {
    const dl = activeDownloads[downloadId];
    if (!dl) return;
    dl._child = null;
    if (dl.status === 'stopped') {
      saveDownloads();
      return;
    }
    if (code === 0) {
      dl.status   = 'done';
      dl.progress = null;
      io.emit('download:complete', { id: downloadId, modelId, status: 'done' });
      // Auto-distribute to other nodes if requested
      if (dl.distributed) {
        const settings = getSettings();
        const sourceNode = settings.nodes[0]?.name;
        const targetNodes = settings.nodes.slice(1).map(n => n.name);
        if (sourceNode && targetNodes.length > 0) {
          console.log(`[download] Auto-distributing ${modelId} from ${sourceNode} to ${targetNodes.join(', ')}`);
          dl.status = 'distributing';
          io.emit('download:progress', { id: downloadId, modelId, status: 'distributing' });
          // Trigger sync (reuse the sync logic)
          const sshUser = settings.sshUser || 'admin';
          const modelDir = modelId.replace('/', '--');
          const modelPath = `~/.exo/models/${modelDir}`;
          for (const targetName of targetNodes) {
            const source = settings.nodes[0];
            const target = settings.nodes.find(n => n.name === targetName);
            if (!target) continue;
            const cmd = `ssh -o StrictHostKeyChecking=accept-new ${sshUser}@${source.ip} 'rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" ${modelPath}/ ${sshUser}@${target.ip}:${modelPath}/'`;
            const syncChild = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
            syncChild.on('close', (syncCode) => {
              console.log(`[download] Sync ${modelId} → ${targetName}: ${syncCode === 0 ? 'OK' : 'FAILED'}`);
            });
          }
        }
      }
    } else {
      dl.status = 'error';
      dl.error  = dl.error || `Exit code ${code}`;
      io.emit('download:complete', { id: downloadId, modelId, status: 'error', error: dl.error });
    }
    saveDownloads();
    processQueue();
  });

  return downloadId;
}

// POST /api/download — enqueue/start a HuggingFace model download
// body: { modelId: 'mlx-community/ModelName', distributed?: boolean }
app.post('/api/download', requireRole('admin'), (req, res) => {
  const { modelId, distributed } = req.body;
  if (!modelId || !modelId.includes('/')) {
    return res.status(400).json({ error: 'modelId must be in format community/model-name' });
  }
  const downloadId = startDownload(modelId);
  // Mark for auto-distribution after download completes
  if (distributed && activeDownloads[downloadId]) {
    activeDownloads[downloadId].distributed = true;
  }
  res.json({ downloadId, modelId, distributed: !!distributed, status: activeDownloads[downloadId]?.status || 'started' });
});

// GET /api/downloads — list all downloads (strip internal fields)
app.get('/api/downloads', (req, res) => {
  const list = Object.values(activeDownloads).map(({ _child, lastStderr, ...rest }) => rest);
  res.json(list);
});

// POST /api/download/cancel/:id — stop an active or queued download
app.post('/api/download/cancel/:id', requireRole('admin'), (req, res) => {
  const dl = activeDownloads[req.params.id];
  if (!dl) return res.status(404).json({ error: 'Download not found' });

  if (dl.status === 'queued') {
    const qi = downloadQueue.findIndex(q => q.queueId === req.params.id);
    if (qi >= 0) downloadQueue.splice(qi, 1);
    dl.status = 'stopped';
    saveDownloads();
    io.emit('download:complete', { id: req.params.id, modelId: dl.modelId, status: 'stopped' });
    processQueue();
    return res.json({ id: req.params.id, status: 'stopped' });
  }

  if (dl.status !== 'downloading') return res.json({ id: req.params.id, status: dl.status });

  dl.status = 'stopped';
  if (dl._child) { dl._child.kill('SIGTERM'); dl._child = null; }
  io.emit('download:complete', { id: req.params.id, modelId: dl.modelId, status: 'stopped' });
  saveDownloads();
  processQueue();
  res.json({ id: req.params.id, status: 'stopped' });
});

// DELETE /api/download/:id — remove a download record entirely
app.delete('/api/download/:id', requireRole('admin'), (req, res) => {
  const dl = activeDownloads[req.params.id];
  if (!dl) return res.status(404).json({ error: 'Download not found' });
  if (dl._child) { dl._child.kill('SIGTERM'); dl._child = null; }
  delete activeDownloads[req.params.id];
  io.emit('download:removed', { id: req.params.id });
  saveDownloads();
  res.json({ ok: true });
});

// POST /api/download/restart/:id — restart a stopped/errored download
app.post('/api/download/restart/:id', requireRole('admin'), (req, res) => {
  const old = activeDownloads[req.params.id];
  if (!old) return res.status(404).json({ error: 'Download not found' });
  const { modelId } = old;
  if (old._child) { old._child.kill('SIGTERM'); old._child = null; }
  delete activeDownloads[req.params.id];
  io.emit('download:removed', { id: req.params.id });
  const newId = startDownload(modelId);
  res.json({ downloadId: newId, modelId, status: activeDownloads[newId]?.status || 'started' });
});

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG API
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'catalog.json');

// Default EXO-compatible MLX models catalog
const DEFAULT_CATALOG = [
  { id: 'mlx-community/Qwen2.5-32B-Instruct-8bit',           params: '32B',       benchmark: 'green',  bestFor: ['chat', 'code', 'french'] },
  { id: 'mlx-community/Qwen2.5-72B-Instruct-4bit',           params: '72B (Q4)',  benchmark: 'yellow', bestFor: ['chat', 'reasoning', 'french'] },
  { id: 'mlx-community/Meta-Llama-3.3-70B-Instruct-4bit',    params: '70B (Q4)',  benchmark: 'yellow', bestFor: ['chat', 'code'] },
  { id: 'mlx-community/Mistral-Large-Instruct-2407-4bit',     params: '123B (Q4)', benchmark: 'yellow', bestFor: ['chat', 'writing', 'french'] },
  { id: 'mlx-community/DeepSeek-Coder-V2-Instruct-4bit',     params: '236B MoE',  benchmark: 'green',  bestFor: ['code', 'analyse'] },
  { id: 'mlx-community/Qwen2.5-Coder-32B-Instruct-8bit',     params: '32B',       benchmark: 'green',  bestFor: ['code'] },
  { id: 'mlx-community/gemma-3-27b-it-8bit',                 params: '27B',       benchmark: 'green',  bestFor: ['chat', 'reasoning'] },
];

function loadCatalog() {
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[catalog] Failed to load:', e.message);
  }
  return [...DEFAULT_CATALOG];
}

function saveCatalog(catalog) {
  const dir = path.dirname(CATALOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
}

// GET /api/catalog
app.get('/api/catalog', (req, res) => {
  res.json(loadCatalog());
});

// PUT /api/catalog — replace entire catalog
app.put('/api/catalog', (req, res) => {
  const catalog = req.body;
  if (!Array.isArray(catalog)) return res.status(400).json({ error: 'Catalog must be an array' });
  saveCatalog(catalog);
  res.json({ ok: true, count: catalog.length });
});

// POST /api/catalog — upsert a single model
app.post('/api/catalog', (req, res) => {
  const model = req.body;
  if (!model.id) return res.status(400).json({ error: 'Model must have an id' });
  const catalog  = loadCatalog();
  const existing = catalog.findIndex(m => m.id === model.id);
  if (existing >= 0) catalog[existing] = model;
  else               catalog.push(model);
  saveCatalog(catalog);
  res.json({ ok: true, model });
});

// DELETE /api/catalog/:id
app.delete('/api/catalog/:id(*)', (req, res) => {
  const modelId  = req.params.id;
  const catalog  = loadCatalog();
  const filtered = catalog.filter(m => m.id !== modelId);
  if (filtered.length === catalog.length) return res.status(404).json({ error: 'Model not found' });
  saveCatalog(filtered);
  res.json({ ok: true, removed: modelId });
});

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS API — persisted in data/system-prompts.json
// ─────────────────────────────────────────────────────────────────────────────

const PROMPTS_PATH = path.join(__dirname, '..', 'data', 'system-prompts.json');

function loadSystemPrompts() {
  try {
    if (fs.existsSync(PROMPTS_PATH)) return JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
  } catch (e) { console.error('[prompts] Failed to load:', e.message); }
  return [];
}

function saveSystemPrompts(prompts) {
  const dir = path.dirname(PROMPTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), 'utf8');
}

// GET /api/system-prompts
app.get('/api/system-prompts', (req, res) => {
  res.json(loadSystemPrompts());
});

// PUT /api/system-prompts — replace all
app.put('/api/system-prompts', (req, res) => {
  const prompts = req.body;
  if (!Array.isArray(prompts)) return res.status(400).json({ error: 'Must be an array' });
  saveSystemPrompts(prompts);
  res.json({ ok: true, count: prompts.length });
});

// POST /api/system-prompts — add one
app.post('/api/system-prompts', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const prompts = loadSystemPrompts();
  const existing = prompts.findIndex(p => p.name === name);
  if (existing >= 0) prompts[existing].content = content;
  else prompts.push({ name, content });
  saveSystemPrompts(prompts);
  res.json({ ok: true, prompt: { name, content } });
});

// DELETE /api/system-prompts/:name
app.delete('/api/system-prompts/:name', (req, res) => {
  const prompts = loadSystemPrompts();
  const filtered = prompts.filter(p => p.name !== req.params.name);
  saveSystemPrompts(filtered);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTS API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/projects/categories — predefined categories
app.get('/api/projects/categories', (req, res) => {
  res.json(PROJECT_CATEGORIES);
});

// GET /api/projects — list all projects
app.get('/api/projects', (req, res) => {
  res.json(getProjStore(req).listProjects());
});

// GET /api/projects/:id — full project
app.get('/api/projects/:id', (req, res) => {
  const proj = getProjStore(req).getProject(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(proj);
});

// POST /api/projects — create project
app.post('/api/projects', (req, res) => {
  const proj = getProjStore(req).createProject(req.body);
  res.json(proj);
});

// PUT /api/projects/:id — update project
app.put('/api/projects/:id', (req, res) => {
  const proj = getProjStore(req).updateProject(req.params.id, req.body);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(proj);
});

// DELETE /api/projects/:id — delete project (conversations are NOT deleted, just unlinked)
app.delete('/api/projects/:id', (req, res) => {
  const ok = getProjStore(req).deleteProject(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Project not found' });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// TTS API (proxies to Kokoro / OpenAI-compatible TTS endpoint)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tts/voices — list available voices
app.get('/api/tts/voices', async (req, res) => {
  const settings = getSettings();
  if (!settings.tts?.enabled || !settings.tts?.endpoint) {
    return res.status(400).json({ error: 'TTS not configured' });
  }
  try {
    const r = await fetch(`${settings.tts.endpoint}/v1/audio/voices`);
    if (!r.ok) throw new Error(`TTS endpoint returned ${r.status}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `TTS voices fetch failed: ${e.message}` });
  }
});

// TTS: split text into chunks at paragraph/sentence boundaries
function splitTtsChunks(text, maxChars = 1500) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxChars) {
      current = current ? current + '\n\n' + para : para;
      continue;
    }
    if (current) { chunks.push(current); current = ''; }
    if (para.length <= maxChars) {
      current = para;
    } else {
      // Split long paragraph at sentence boundaries
      const sentences = para.split(/(?<=[.!?…])\s+/);
      for (const s of sentences) {
        if (current.length + s.length + 1 <= maxChars) {
          current = current ? current + ' ' + s : s;
        } else {
          if (current) chunks.push(current);
          current = s;
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// TTS: extract raw PCM from WAV buffer (skip RIFF/fmt/data headers)
function extractPcm(wavBuf) {
  let pos = 12; // skip RIFF header
  let sampleRate = 24000, numChannels = 1, bitsPerSample = 16, pcm = null;
  while (pos < wavBuf.length - 8) {
    const id = wavBuf.slice(pos, pos + 4).toString('ascii');
    const size = wavBuf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      numChannels = wavBuf.readUInt16LE(pos + 10);
      sampleRate = wavBuf.readUInt32LE(pos + 12);
      bitsPerSample = wavBuf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      pcm = wavBuf.slice(pos + 8, pos + 8 + size);
    }
    pos += 8 + size;
    if (pos % 2 === 1) pos++;
  }
  return { pcm: pcm || Buffer.alloc(0), sampleRate, numChannels, bitsPerSample };
}

// TTS: build WAV from raw PCM
function buildWav(pcm, sampleRate, numChannels, bitsPerSample) {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// POST /api/tts/speech — generate speech audio (with auto-chunking)
app.post('/api/tts/speech', async (req, res) => {
  const settings = getSettings();
  if (!settings.tts?.enabled || !settings.tts?.endpoint) {
    return res.status(400).json({ error: 'TTS not configured' });
  }
  const { input, voice, response_format } = req.body;
  if (!input) return res.status(400).json({ error: 'input is required' });

  const chunks = splitTtsChunks(input);
  const ttsVoice = voice || settings.tts.voice || 'ff_siwis';
  const ttsModel = settings.tts.model || 'kokoro';
  const fmt = response_format || 'wav';

  try {
    const pcmParts = [];
    let sampleRate = 24000, numChannels = 1, bitsPerSample = 16;
    const silenceDuration = 0.4; // seconds between chunks

    for (let i = 0; i < chunks.length; i++) {
      const r = await fetch(`${settings.tts.endpoint}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: chunks[i], model: ttsModel, voice: ttsVoice, response_format: fmt }),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`TTS returned ${r.status}: ${errText}`);
      }
      const wavBuf = Buffer.from(await r.arrayBuffer());
      const { pcm, sampleRate: sr, numChannels: nc, bitsPerSample: bps } = extractPcm(wavBuf);
      sampleRate = sr; numChannels = nc; bitsPerSample = bps;
      pcmParts.push(pcm);

      // Add silence between chunks
      if (i < chunks.length - 1) {
        const silenceBytes = Math.round(silenceDuration * sr * nc * bps / 8);
        pcmParts.push(Buffer.alloc(silenceBytes));
      }
    }

    const fullPcm = Buffer.concat(pcmParts);
    const wav = buildWav(fullPcm, sampleRate, numChannels, bitsPerSample);
    res.set('Content-Type', 'audio/wav');
    res.send(wav);
  } catch (e) {
    res.status(502).json({ error: `TTS speech failed: ${e.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATIONS API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/conversations — lightweight list (no full messages)
app.get('/api/conversations', (req, res) => {
  res.json(getConvStore(req).listConversations());
});

// GET /api/conversations/:id — full conversation + inference status
app.get('/api/conversations/:id', (req, res) => {
  const conv = getConvStore(req).getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const inference = getInferenceStatus(req.params.id);
  res.json({ ...conv, inference });
});

// POST /api/conversations — create new conversation
app.post('/api/conversations', (req, res) => {
  const conv = getConvStore(req).createConversation(req.body);
  res.json(conv);
});

// PUT /api/conversations/:id — update (rename, pin, etc.)
app.put('/api/conversations/:id', (req, res) => {
  const conv = getConvStore(req).updateConversation(req.params.id, req.body);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

// DELETE /api/conversations/:id
app.delete('/api/conversations/:id', (req, res) => {
  const ok = getConvStore(req).deleteConversation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ ok: true });
});

// GET /api/conversations/:id/inference — inference status
app.get('/api/conversations/:id/inference', (req, res) => {
  res.json(getInferenceStatus(req.params.id));
});

// POST /api/conversations/:id/inference/clear — clear consumed inference result
app.post('/api/conversations/:id/inference/clear', (req, res) => {
  clearInference(req.params.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAT API
// ─────────────────────────────────────────────────────────────────────────────

/** Return base URL for a chat engine key (from settings.chat), with fallback to first node. */
function getChatEndpoint(engine) {
  if (engine === 'openrouter') {
    const settings = getSettings();
    return settings.openRouterApiKey ? { base: 'https://openrouter.ai/api', type: 'openrouter', apiKey: settings.openRouterApiKey } : null;
  }
  const settings = getSettings();
  const cfg      = (settings.chat || {})[engine];
  const ip = cfg?.ip || settings.nodes?.[0]?.ip;
  const port = cfg?.port || settings.exoPort || 52415;
  if (!ip) return null;
  return { base: `http://${ip}:${port}`, type: 'exo', apiKey: null };
}

// GET /api/chat/engines — list configured EXO chat engines
// Filters out legacy 'exo' key when exo1 exists, drops any inferencer keys.
app.get('/api/chat/engines', (req, res) => {
  const settings = getSettings();
  const chat     = settings.chat || {};
  const keys     = Object.keys(chat);

  const filtered = keys.filter(k => {
    if (k === 'exo' && keys.includes('exo1')) return false;
    if (k.startsWith('inferencer'))            return false;  // EXO-only
    return true;
  });

  const engines = filtered.map(key => ({
    id:   key,
    name: chat[key].name || key,
    ip:   chat[key].ip,
    port: chat[key].port,
  })).sort((a, b) => {
    const order = { exo1: 0, exo2: 1, exo: 2 };
    return (order[a.id] ?? 9) - (order[b.id] ?? 9);
  });

  res.json(engines);
});

// GET /api/chat/active-model?engine=exo1|exo2 — currently loaded model via /state
app.get('/api/chat/active-model', async (req, res) => {
  const engine = req.query.engine || 'exo1';
  const eng    = getChatEndpoint(engine);
  if (!eng || eng.type !== 'exo') return res.json({ activeModel: null });

  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 4000);
    const r    = await fetch(`${eng.base}/state`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await r.json();

    let activeModel = null;
    for (const inst of Object.values(data.instances || {})) {
      const inner   = inst.MlxJacclInstance || inst.MlxInstance || Object.values(inst)[0];
      const modelId = inner?.shardAssignments?.modelId;
      if (modelId) { activeModel = modelId; break; }
    }
    res.json({ activeModel });
  } catch (e) {
    res.json({ activeModel: null });
  }
});

// GET /api/chat/models?engine=exo1|openrouter — models list
app.get('/api/chat/models', async (req, res) => {
  const engine = req.query.engine || 'exo1';
  const eng    = getChatEndpoint(engine);
  if (!eng) return res.status(400).json({ error: `Unknown engine: ${engine}` });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    if (eng.type === 'openrouter') {
      // OpenRouter: /v1/models with API key — grouped by provider
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${eng.apiKey}` };
      const r = await fetch(`${eng.base}/v1/models`, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) return res.json({ engine, models: [], error: `HTTP ${r.status}` });
      const data = await r.json();
      const allModels = (data.data || [])
        .filter(m => m.id)
        .map(m => {
          const provider = m.id.split('/')[0] || 'other';
          return { id: m.id, name: m.name || m.id, context: m.context_length, pricing: m.pricing, group: provider };
        })
        .sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
      const groups = {};
      for (const m of allModels) {
        if (!groups[m.group]) groups[m.group] = [];
        groups[m.group].push(m);
      }
      return res.json({ engine, models: allModels, groups });
    }

    // EXO: use /v1/models?status=downloaded (cleaner than parsing /state DownloadCompleted)
    const r = await fetch(`${eng.base}/v1/models?status=downloaded`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.json({ engine, models: [], error: `HTTP ${r.status}` });
    const data = await r.json();
    const models = (data.data || [])
      .filter(m => ![...deletedModels].some(d => d.startsWith(`${m.id}::`)))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(m => ({ id: m.id, name: m.id, family: m.family, quantization: m.quantization }));
    res.json({ engine, models });
  } catch (e) {
    res.json({ engine, models: [], error: e.message });
  }
});

// POST /api/chat/cancel/:commandId — cancel an active generation via exo
app.post('/api/chat/cancel/:commandId', async (req, res) => {
  const eng = getChatEndpoint('exo1');
  if (!eng || eng.type !== 'exo') return res.status(400).json({ error: 'No exo endpoint' });
  try {
    const r = await fetch(`${eng.base}/v1/cancel/${req.params.commandId}`, { method: 'POST' });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/instance-preview?modelId=... — check placement/RAM before loading
app.get('/api/chat/instance-preview', async (req, res) => {
  const eng = getChatEndpoint('exo1');
  if (!eng || eng.type !== 'exo') return res.json({ error: 'No exo endpoint' });
  const modelId = req.query.modelId;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(`${eng.base}/instance/previews?model_id=${encodeURIComponent(modelId)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.json({ previews: [] });
    const data = await r.json();
    // Extract useful info from previews
    const previews = (data.previews || []).map(p => {
      const inner = p.instance?.[Object.keys(p.instance || {})[0]];
      const shard = inner?.shardAssignments;
      const runners = shard?.runnerToShard || {};
      const firstRunner = Object.values(runners)[0];
      const meta = firstRunner?.PipelineShardMetadata?.modelCard || firstRunner?.TensorShardMetadata?.modelCard || {};
      return {
        modelId: p.model_id,
        sharding: p.sharding,
        instanceMeta: p.instance_meta,
        nodeCount: Object.keys(runners).length,
        storageGB: meta.storageSize ? Math.round(meta.storageSize.inBytes / 1073741824) : null,
        nLayers: meta.nLayers,
        family: meta.family,
        quantization: meta.quantization,
      };
    });
    res.json({ previews });
  } catch (e) {
    res.json({ previews: [], error: e.message });
  }
});

// POST /api/chat/completions — proxy to EXO with SSE streaming + background persistence
app.post('/api/chat/completions', async (req, res) => {
  const {
    engine, model, messages, temperature, max_tokens, stream, thinking,
    top_p, top_k, min_p, repetition_penalty, seed, reasoning_effort,
    conversationId,
  } = req.body;

  // Guest token limit check
  if (req.user?.role === 'guest') {
    const settings = getSettings();
    const used = req.session.guestTokensUsed || 0;
    if (used >= settings.guestTokenLimit) {
      return res.status(429).json({ error: 'Guest token limit reached. Please log in to continue.' });
    }
  }

  const eng = getChatEndpoint(engine || 'exo1');
  if (!eng) return res.status(400).json({ error: `Unknown engine: ${engine}` });

  const isStreaming = stream !== false;

  // Build request body — adapt per engine type
  const body = {
    model,
    messages: [...messages],
    stream: isStreaming,
  };

  if (eng.type === 'exo') {
    // EXO-specific params
    if (isStreaming)           body.stream_options        = { include_usage: true };
    if (temperature != null)   body.temperature           = temperature;
    if (max_tokens  != null)   body.max_tokens            = max_tokens;
    body.enable_thinking = thinking === true;
    if (top_p       != null)   body.top_p                 = top_p;
    if (top_k       != null)   body.top_k                 = top_k;
    if (min_p       != null)   body.min_p                 = min_p;
    if (repetition_penalty != null) body.repetition_penalty = repetition_penalty;
    if (seed        != null)   body.seed                  = seed;
    if (thinking && reasoning_effort) body.reasoning_effort = reasoning_effort;
  } else {
    // OpenRouter / standard OpenAI params
    if (temperature != null)   body.temperature           = temperature;
    if (max_tokens  != null)   body.max_tokens            = max_tokens;
    if (top_p       != null)   body.top_p                 = top_p;
    if (seed        != null)   body.seed                  = seed;
  }

  // Build headers per engine type
  const headers = { 'Content-Type': 'application/json' };
  if (eng.type === 'openrouter' && eng.apiKey) {
    headers['Authorization'] = `Bearer ${eng.apiKey}`;
    headers['HTTP-Referer']  = 'https://exoscopy.local';
    headers['X-Title']       = 'ExoScopy';
  } else {
    headers['Authorization'] = 'Bearer x';
  }

  console.log(`[chat] engine=${engine} type=${eng.type} model="${model}" conv=${conversationId || 'none'} stream=${body.stream}`);

  // Resolve user's conversation store
  const convStore = getConvStore(req);

  // Persist user message
  if (conversationId) {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg?.role === 'user') {
      convStore.addMessage(conversationId, 'user', lastUserMsg.content);
    }
    startInference(conversationId);
  }

  try {
    const fetchRes = await fetch(`${eng.base}/v1/chat/completions`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (!fetchRes.ok) {
      let errBody = '';
      try { errBody = await fetchRes.text(); } catch (e) {}
      console.error(`[chat] Upstream ${fetchRes.status}: ${errBody}`);
      if (conversationId) finishInference(conversationId, convStore.addMessage, errBody);
      return res.status(fetchRes.status).json({
        error:  `Engine returned ${fetchRes.status}`,
        detail: errBody,
        model,
      });
    }

    if (body.stream) {
      res.setHeader('Content-Type',    'text/event-stream');
      res.setHeader('Cache-Control',   'no-cache');
      res.setHeader('Connection',      'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const reader  = fetchRes.body.getReader();
      const decoder = new TextDecoder();
      let clientConnected = true;

      req.on('close', () => {
        clientConnected = false;
        // Server continues pumping — response is persisted in background
        console.log(`[chat] Client disconnected, inference continues in background for conv=${conversationId || 'none'}`);
      });

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });

            if (clientConnected) {
              try { res.write(chunk); } catch (e) { clientConnected = false; }
            }

            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (conversationId) {
                  const delta = parsed.choices?.[0]?.delta;
                  const text = delta?.content;
                  const think = delta?.reasoning_content;
                  if (think) {
                    const inf = getInferenceStatus(conversationId);
                    if (inf.active && !inf.content?.includes('<think>')) {
                      appendInferenceContent(conversationId, '<think>');
                    }
                    appendInferenceContent(conversationId, think);
                  } else if (text) {
                    const inf = getInferenceStatus(conversationId);
                    if (inf.active && inf.content?.includes('<think>') && !inf.content?.includes('</think>')) {
                      appendInferenceContent(conversationId, '</think>');
                    }
                    appendInferenceContent(conversationId, text);
                  }
                }
                // Track guest tokens from usage field in final chunk
                if (req.user?.role === 'guest' && parsed.usage?.total_tokens) {
                  req.session.guestTokensUsed = (req.session.guestTokensUsed || 0) + parsed.usage.total_tokens;
                }
              } catch (e) { /* not JSON */ }
            }
          }
        } catch (e) {
          console.error(`[chat] Stream error: ${e.message}`);
          if (conversationId) finishInference(conversationId, convStore.addMessage, e.message);
        }
        if (conversationId) finishInference(conversationId, convStore.addMessage);
        if (clientConnected) { try { res.end(); } catch (e) {} }
      };
      pump();

    } else {
      const data = await fetchRes.json();
      if (conversationId && data.choices?.[0]?.message?.content) {
        convStore.addMessage(conversationId, 'assistant', data.choices[0].message.content);
        finishInference(conversationId, convStore.addMessage);
      }
      // Track guest tokens
      if (req.user?.role === 'guest' && data.usage?.total_tokens) {
        req.session.guestTokensUsed = (req.session.guestTokensUsed || 0) + data.usage.total_tokens;
      }
      res.json(data);
    }
  } catch (e) {
    if (conversationId) finishInference(conversationId, convStore.addMessage, e.message);
    res.status(502).json({ error: `Engine unreachable: ${e.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HUGGINGFACE HUB SEARCH
// ─────────────────────────────────────────────────────────────────────────────

// Cache of exo-qualified model IDs (from /v1/models)
let _exoModelIds = null;
let _exoModelIdsTime = 0;
const EXO_MODELS_TTL = 300000; // 5 min cache

async function getExoModelIds() {
  if (_exoModelIds && Date.now() - _exoModelIdsTime < EXO_MODELS_TTL) return _exoModelIds;
  const settings = getSettings();
  const firstNode = settings.nodes[0];
  if (!firstNode) return new Set();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`http://${firstNode.ip}:${settings.exoPort || 52415}/v1/models`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return _exoModelIds || new Set();
    const data = await r.json();
    _exoModelIds = new Set((data.data || []).map(m => m.id));
    _exoModelIdsTime = Date.now();
    return _exoModelIds;
  } catch (e) { return _exoModelIds || new Set(); }
}

// GET /api/hub/search?q=&format=mlx&sort=downloads&limit=40&author=mlx-community
app.get('/api/hub/search', async (req, res) => {
  try {
    const { q, format, sort, limit, author } = req.query;
    const params = new URLSearchParams();
    if (q)      params.set('search', q);
    if (sort)   params.set('sort', sort);
    params.set('direction', '-1');
    params.set('limit', String(Math.min(parseInt(limit) || 40, 100)));
    params.append('expand[]', 'safetensors');
    params.append('expand[]', 'config');

    if (format === 'mlx')          params.set('filter', 'mlx');
    else if (format === 'gguf')    params.set('filter', 'gguf');
    else if (format === 'safetensors') params.set('filter', 'safetensors');
    if (author) params.set('author', author);

    const url    = `https://huggingface.co/api/models?${params.toString()}`;
    const hfRes  = await fetch(url);
    if (!hfRes.ok) throw new Error(`HF API ${hfRes.status}`);
    const models = await hfRes.json();

    const results = models.map(m => {
      const tags = m.tags || [];

      // Detect format
      let detectedFormat = 'safetensors';
      if (tags.includes('mlx') || m.library_name === 'mlx' || (m.id || '').toLowerCase().includes('-mlx'))  detectedFormat = 'mlx';
      else if (tags.includes('gguf')) detectedFormat = 'gguf';

      // Detect quantization (config > tag > name)
      let quantBits = null;
      if (m.config?.quantization_config?.bits) {
        quantBits = m.config.quantization_config.bits;
      } else {
        const bitTag = tags.find(t => /^\d+-bit$/.test(t));
        if (bitTag) quantBits = parseInt(bitTag);
      }
      if (!quantBits) {
        const nameQuantMatch = (m.id || '').toLowerCase().match(/(\d+)\s*bit/);
        if (nameQuantMatch) quantBits = parseInt(nameQuantMatch[1]);
      }

      // Detect precision for non-quantized
      let precision = null;
      const nameLC  = (m.id || '').toLowerCase();
      if (!quantBits) {
        if      (tags.includes('bf16') || nameLC.includes('bf16')) precision = 'bf16';
        else if (tags.includes('fp16') || nameLC.includes('fp16') || nameLC.includes('f16')) precision = 'fp16';
        else if (tags.includes('fp32') || nameLC.includes('fp32') || nameLC.includes('f32')) precision = 'fp32';
      }

      // Parse parameter count from model name (e.g. "70B", "1T", "235B-A22B")
      let namedParams = null;
      const paramMatch = nameLC.match(/(\d+\.?\d*)\s*(b|t)(?:\b|-)/i);
      if (paramMatch) {
        const num = parseFloat(paramMatch[1]);
        namedParams = paramMatch[2].toLowerCase() === 't' ? num * 1000 : num;
      }

      // Estimate size in GB
      const totalParams = m.safetensors?.total || null;
      const bpp         = quantBits ? (quantBits / 8)
                        : precision === 'fp32'               ? 4
                        : (precision === 'bf16' || precision === 'fp16') ? 2 : 2;

      let estimatedSizeGB = null;
      if (namedParams) {
        estimatedSizeGB = Math.round((namedParams * 1e9 * bpp / (1024 ** 3)) * 10) / 10;
      } else if (totalParams) {
        estimatedSizeGB = Math.round((totalParams * bpp / (1024 ** 3)) * 10) / 10;
      }

      return {
        id:             m.id,
        author:         m.id.split('/')[0],
        modelName:      m.id.split('/').slice(1).join('/'),
        downloads:      m.downloads      || 0,
        likes:          m.likes          || 0,
        trendingScore:  m.trendingScore  || 0,
        createdAt:      m.createdAt,
        pipeline_tag:   m.pipeline_tag,
        library:        m.library_name,
        format:         detectedFormat,
        quantBits,
        precision,
        totalParams,
        namedParams,
        estimatedSizeGB,
        tags: tags.filter(t => !t.startsWith('region:') && t !== 'endpoints_compatible'),
      };
    });

    // Filter to exo-qualified models only
    const exoIds = await getExoModelIds();
    const qualified = exoIds.size > 0 ? results.filter(m => exoIds.has(m.id)) : results;
    res.json(qualified);
  } catch (e) {
    console.error('[hub/search]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG CHECK API — verify all dependencies per node
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/config-check', async (req, res) => {
  const settings = getSettings();
  const nodes = settings.nodes;
  const sshUser = settings.sshUser || 'admin';
  const exoPort = settings.exoPort || 52415;

  if (!nodes.length) return res.json({ nodes: [] });

  const results = await Promise.all(nodes.map(async (node) => {
    const checks = {};

    // 1. SSH connectivity (key-based)
    const ssh = await new Promise(resolve => {
      exec(`ssh -o ConnectTimeout=3 -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${sshUser}@${node.ip} 'echo OK'`,
        { timeout: 5000, encoding: 'utf8' },
        (err, stdout) => resolve({ ok: !err && stdout.trim() === 'OK' })
      );
    });
    checks.ssh = ssh.ok;

    // 2. exo API reachable
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(`http://${node.ip}:${exoPort}/v1/models`, { signal: controller.signal });
      clearTimeout(timer);
      checks.exoApi = r.ok;
    } catch (e) { checks.exoApi = false; }

    // If SSH fails, can't check the rest
    if (!ssh.ok) {
      checks.python = false;
      checks.huggingfaceHub = false;
      checks.rsync = false;
      checks.modelPath = false;
      checks.diskFree = null;
      return { name: node.name, ip: node.ip, checks };
    }

    // 3. Python3 available
    const python = await sshExec(node.ip, 'python3 --version 2>&1', 5000);
    checks.python = python.ok && python.stdout.includes('Python 3');
    checks.pythonVersion = python.ok ? python.stdout.trim() : null;

    // 4. huggingface_hub installed (only required on first node — downloads happen there)
    const isFirstNode = node.ip === nodes[0]?.ip;
    if (isFirstNode) {
      const hfHub = await sshExec(node.ip, 'python3 -c "import huggingface_hub; print(huggingface_hub.__version__)" 2>&1', 5000);
      checks.huggingfaceHub = hfHub.ok && !hfHub.stdout.includes('Error') && !hfHub.stdout.includes('No module');
      checks.hfHubVersion = checks.huggingfaceHub ? hfHub.stdout.trim() : null;
    } else {
      checks.huggingfaceHub = null; // not required
      checks.hfHubVersion = null;
    }

    // 5. rsync available
    const rsyncCheck = await sshExec(node.ip, 'which rsync && rsync --version | head -1', 5000);
    checks.rsync = rsyncCheck.ok && rsyncCheck.stdout.includes('rsync');

    // 6. Model path exists and writable
    const modelPath = await sshExec(node.ip, 'test -d ~/.exo/models && test -w ~/.exo/models && echo OK || echo MISSING', 5000);
    checks.modelPath = modelPath.ok && modelPath.stdout.includes('OK');

    // 7. Disk free space
    const disk = await sshExec(node.ip, 'df -h ~/.exo/models 2>/dev/null | tail -1 | awk \'{print $4}\'', 5000);
    checks.diskFree = disk.ok ? disk.stdout.trim() : null;

    // 8. SSH to other nodes (inter-node)
    const otherNodes = nodes.filter(n => n.ip !== node.ip);
    const interNode = {};
    for (const other of otherNodes) {
      const test = await sshExec(node.ip, `ssh -o ConnectTimeout=2 -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${sshUser}@${other.ip} 'echo OK' 2>&1`, 5000);
      interNode[other.name] = test.ok && test.stdout.includes('OK');
    }
    checks.interNodeSSH = interNode;

    return { name: node.name, ip: node.ip, checks };
  }));

  res.json({ nodes: results });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSH KEY SETUP API
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/ssh/test — test SSH connectivity to a node
// body: { ip, user, password? }
app.post('/api/ssh/test', async (req, res) => {
  const { ip, user } = req.body;
  if (!ip || !user) return res.status(400).json({ error: 'ip and user required' });

  // Try key-based first
  const r = await new Promise(resolve => {
    exec(`ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new -o BatchMode=yes ${user}@${ip} 'echo OK'`,
      { timeout: 5000, encoding: 'utf8' },
      (err, stdout) => resolve({ ok: !err && stdout.trim() === 'OK', method: 'key' })
    );
  });

  res.json({ ip, user, connected: r.ok, method: r.ok ? 'key' : 'none' });
});

// POST /api/ssh/setup-keys — generate key pair and install on all nodes via sshpass
// body: { nodes: [{ ip, user, password }] }
app.post('/api/ssh/setup-keys', requireRole('admin'), async (req, res) => {
  const { nodes } = req.body;
  if (!nodes || !Array.isArray(nodes)) return res.status(400).json({ error: 'nodes array required' });

  const keyPath = '/root/.ssh/id_ed25519';
  const results = [];

  // Generate key if not exists
  try {
    if (!fs.existsSync(keyPath)) {
      const { execSync } = require('child_process');
      execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N "" -q`, { encoding: 'utf8' });
      console.log('[ssh] Generated new SSH key pair');
    }
  } catch (e) {
    return res.status(500).json({ error: `Key generation failed: ${e.message}` });
  }

  // Install key on each node
  for (const node of nodes) {
    const { ip, user, password } = node;
    if (!ip || !user || !password) {
      results.push({ ip, ok: false, error: 'Missing ip, user, or password' });
      continue;
    }

    try {
      // Use sshpass to copy the key
      const r = await new Promise(resolve => {
        exec(
          `sshpass -p '${password.replace(/'/g, "'\\''")}' ssh-copy-id -o StrictHostKeyChecking=accept-new -i ${keyPath}.pub ${user}@${ip}`,
          { timeout: 15000, encoding: 'utf8' },
          (err, stdout, stderr) => {
            if (err) resolve({ ok: false, error: stderr || err.message });
            else resolve({ ok: true });
          }
        );
      });

      // Verify
      if (r.ok) {
        const verify = await new Promise(resolve => {
          exec(`ssh -o ConnectTimeout=3 -o BatchMode=yes ${user}@${ip} 'echo OK'`,
            { timeout: 5000, encoding: 'utf8' },
            (err, stdout) => resolve({ ok: !err && stdout.trim() === 'OK' })
          );
        });
        results.push({ ip, user, ok: verify.ok, error: verify.ok ? null : 'Key installed but verification failed' });
      } else {
        results.push({ ip, user, ok: false, error: r.error });
      }
    } catch (e) {
      results.push({ ip, user, ok: false, error: e.message });
    }
  }

  // Phase 2: Install inter-node keys (each node → every other node)
  // For each node that we can now access via key, generate a key and copy it to all others
  const interNodeResults = [];
  for (const nodeA of nodes) {
    for (const nodeB of nodes) {
      if (nodeA.ip === nodeB.ip) continue;
      const keyGenCmd = `ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes ${nodeA.user}@${nodeA.ip} 'test -f ~/.ssh/id_ed25519 || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -q; cat ~/.ssh/id_ed25519.pub'`;
      const pubKey = await new Promise(resolve => {
        exec(keyGenCmd, { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
          resolve(err ? null : stdout.trim());
        });
      });
      if (!pubKey) { interNodeResults.push({ from: nodeA.ip, to: nodeB.ip, ok: false, error: 'Cannot read pubkey' }); continue; }

      // Use sshpass to install A's key on B
      const installCmd = `sshpass -p '${nodeB.password.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=accept-new ${nodeB.user}@${nodeB.ip} "mkdir -p ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys"`;
      const installR = await new Promise(resolve => {
        exec(installCmd, { timeout: 10000, encoding: 'utf8' }, (err) => resolve({ ok: !err }));
      });
      interNodeResults.push({ from: nodeA.ip, to: nodeB.ip, ok: installR.ok });
    }
  }

  console.log('[ssh] Container→node results:', results.map(r => `${r.ip}: ${r.ok ? 'OK' : r.error}`).join(', '));
  console.log('[ssh] Inter-node results:', interNodeResults.map(r => `${r.from}→${r.to}: ${r.ok ? 'OK' : r.error || 'FAIL'}`).join(', '));
  res.json({ results, interNodeResults });
});

// ─────────────────────────────────────────────────────────────────────────────
// SYNC API — rsync models between nodes
// ─────────────────────────────────────────────────────────────────────────────

// Active syncs tracking
const activeSyncs = {};

// Deleted models tracking (exo /state keeps DownloadCompleted even after rm)
// Persist deleted models across restarts
const DELETED_MODELS_PATH = path.join(__dirname, '..', 'data', 'deleted-models.json');
let deletedModels;
try {
  deletedModels = new Set(fs.existsSync(DELETED_MODELS_PATH) ? JSON.parse(fs.readFileSync(DELETED_MODELS_PATH, 'utf8')) : []);
} catch (e) { deletedModels = new Set(); }
function saveDeletedModels() {
  try {
    const dir = path.dirname(DELETED_MODELS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DELETED_MODELS_PATH, JSON.stringify([...deletedModels], null, 2), 'utf8');
  } catch (e) { console.error('[deletedModels] save error:', e.message); }
}

// POST /api/models/sync — rsync a model from source node to target nodes
// body: { modelId, sourceNode, targetNodes: [name], modelPath? }
app.post('/api/models/sync', requireRole('admin'), async (req, res) => {
  const { modelId, sourceNode, targetNodes } = req.body;
  if (!modelId || !sourceNode || !targetNodes?.length) {
    return res.status(400).json({ error: 'modelId, sourceNode, and targetNodes required' });
  }

  const settings = getSettings();
  const source = settings.nodes.find(n => n.name === sourceNode);
  if (!source) return res.status(400).json({ error: `Source node ${sourceNode} not found` });

  const syncId = `sync-${Date.now()}`;
  const sshUser = settings.sshUser || 'admin';
  // exo model path: ~/.exo/models/<modelId-with-dashes>
  const modelDir = modelId.replace('/', '--');
  const modelPath = `~/.exo/models/${modelDir}`;

  activeSyncs[syncId] = {
    id: syncId, modelId, sourceNode, targetNodes,
    status: 'syncing', startedAt: new Date().toISOString(),
    progress: {},
    _children: [], // track child processes for cancel
  };

  res.json({ syncId, status: 'started' });

  // Run rsync to each target in parallel
  for (const targetName of targetNodes) {
    const target = settings.nodes.find(n => n.name === targetName);
    if (!target) {
      activeSyncs[syncId].progress[targetName] = { status: 'error', error: 'Node not found' };
      io.emit('sync:progress', { syncId, modelId, node: targetName, status: 'error', error: 'Node not found' });
      continue;
    }

    activeSyncs[syncId].progress[targetName] = { status: 'syncing', percent: 0 };
    io.emit('sync:progress', { syncId, modelId, node: targetName, status: 'syncing', percent: 0 });

    // SSH into source node, rsync to target.
    // Requires inter-node SSH keys (installed via Setup SSH Keys in Settings)
    const cmd = `ssh -o StrictHostKeyChecking=accept-new ${sshUser}@${source.ip} 'rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" ${modelPath}/ ${sshUser}@${target.ip}:${modelPath}/'`;
    console.log(`[sync] ${modelId}: ${source.ip} → ${target.ip}`);

    const child = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    activeSyncs[syncId]._children.push(child);

    child.stdout.on('data', (buf) => {
      const lines = buf.toString().split('\n');
      for (const line of lines) {
        // Parse rsync progress: "  1,234,567  45%  12.34MB/s"
        const match = line.match(/(\d+)%/);
        if (match) {
          const percent = parseInt(match[1]);
          if (activeSyncs[syncId]) {
            activeSyncs[syncId].progress[targetName].percent = percent;
          }
          io.emit('sync:progress', { syncId, modelId, node: targetName, status: 'syncing', percent });
        }
      }
    });

    child.on('close', (code) => {
      if (!activeSyncs[syncId]) return; // cancelled
      if (code === 0) {
        activeSyncs[syncId].progress[targetName] = { status: 'done', percent: 100 };
        io.emit('sync:progress', { syncId, modelId, node: targetName, status: 'done', percent: 100 });
      } else if (activeSyncs[syncId].status === 'cancelled') {
        // Already handled by cancel endpoint
      } else {
        activeSyncs[syncId].progress[targetName] = { status: 'error', error: `rsync exit ${code}` };
        io.emit('sync:progress', { syncId, modelId, node: targetName, status: 'error' });
      }

      // Check if all targets done
      const allDone = targetNodes.every(n => {
        const p = activeSyncs[syncId]?.progress[n];
        return p && (p.status === 'done' || p.status === 'error' || p.status === 'cancelled');
      });
      if (allDone && activeSyncs[syncId]) {
        activeSyncs[syncId].status = 'done';
        delete activeSyncs[syncId]._children;
        io.emit('sync:complete', { syncId, modelId });
      }
    });
  }
});

// POST /api/models/delete — delete a model from a specific node via SSH
// body: { modelId, nodeName }
app.post('/api/models/delete', requireRole('admin'), async (req, res) => {
  const { modelId, nodeName } = req.body;
  if (!modelId || !nodeName) return res.status(400).json({ error: 'modelId and nodeName required' });

  const settings = getSettings();
  const node = settings.nodes.find(n => n.name === nodeName);
  if (!node) return res.status(400).json({ error: `Node ${nodeName} not found` });

  const sshUser = settings.sshUser || 'admin';
  const modelDir = modelId.replace('/', '--');
  const modelPath = `~/.exo/models/${modelDir}`;

  console.log(`[delete] ${modelId} on ${nodeName} (${node.ip}): rm -rf ${modelPath}`);

  const r = await sshExec(node.ip, `rm -rf ${modelPath} && echo DELETED`, 30000);
  if (r.ok && r.stdout === 'DELETED') {
    deletedModels.add(`${modelId}::${nodeName}`);
    saveDeletedModels();
    res.json({ ok: true, modelId, nodeName });
  } else {
    res.status(500).json({ ok: false, error: r.error || 'Delete failed' });
  }
});

// GET /api/models/syncs — list active syncs
app.get('/api/models/syncs', (req, res) => {
  const clean = Object.values(activeSyncs).map(s => {
    const { _children, ...rest } = s;
    return rest;
  });
  res.json(clean);
});

// DELETE /api/models/syncs/:syncId — cancel/kill a running sync
app.delete('/api/models/syncs/:syncId', requireRole('admin'), (req, res) => {
  const sync = activeSyncs[req.params.syncId];
  if (!sync) return res.status(404).json({ error: 'Sync not found' });

  console.log(`[sync] Cancelling ${sync.id} (${sync.modelId})`);
  sync.status = 'cancelled';

  // Kill all child processes
  if (sync._children) {
    for (const child of sync._children) {
      try { child.kill('SIGTERM'); } catch (e) {}
    }
  }

  // Mark all in-progress targets as cancelled
  for (const [node, p] of Object.entries(sync.progress)) {
    if (p.status === 'syncing') {
      sync.progress[node] = { status: 'cancelled' };
      io.emit('sync:progress', { syncId: sync.id, modelId: sync.modelId, node, status: 'cancelled' });
    }
  }

  delete activeSyncs[req.params.syncId];
  io.emit('sync:complete', { syncId: sync.id, modelId: sync.modelId, cancelled: true });
  res.json({ ok: true });
});

// POST /api/models/import — import a model from an external source via rsync
// body: { sourceIp, sourceUser, sourcePassword?, sourcePath, targetNode, modelId? }
app.post('/api/models/import', async (req, res) => {
  const { sourceIp, sourceUser, sourcePath, targetNode, modelId } = req.body;
  if (!sourceIp || !sourceUser || !sourcePath || !targetNode) {
    return res.status(400).json({ error: 'sourceIp, sourceUser, sourcePath, targetNode required' });
  }

  const settings = getSettings();
  const target = settings.nodes.find(n => n.name === targetNode);
  if (!target) return res.status(400).json({ error: `Target node ${targetNode} not found` });

  const sshUser = settings.sshUser || 'admin';
  // Derive model dir name from source path
  const dirName = path.basename(sourcePath);
  const targetPath = `~/.exo/models/${dirName}`;

  const importId = `import-${Date.now()}`;
  activeSyncs[importId] = {
    id: importId, type: 'import', modelId: modelId || dirName,
    sourceIp, targetNode, status: 'importing', startedAt: new Date().toISOString(),
    progress: { percent: 0 },
  };

  res.json({ importId, status: 'started' });

  // SSH into source machine, rsync from there to target node
  const cmd = `ssh -o StrictHostKeyChecking=accept-new ${sourceUser}@${sourceIp} 'rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" ${sourcePath}/ ${sshUser}@${target.ip}:${targetPath}/'`;
  console.log(`[import] ${sourcePath} → ${target.ip}:${targetPath}`);

  const child = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (buf) => {
    const lines = buf.toString().split('\n');
    for (const line of lines) {
      const match = line.match(/(\d+)%/);
      if (match) {
        activeSyncs[importId].progress.percent = parseInt(match[1]);
        io.emit('sync:progress', { syncId: importId, modelId: modelId || dirName, node: targetNode, status: 'importing', percent: parseInt(match[1]) });
      }
    }
  });

  child.on('close', (code) => {
    activeSyncs[importId].status = code === 0 ? 'done' : 'error';
    activeSyncs[importId].progress.percent = code === 0 ? 100 : 0;
    io.emit('sync:complete', { syncId: importId, modelId: modelId || dirName, status: code === 0 ? 'done' : 'error' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVER API — scan local /24 subnet for EXO nodes (port 52415)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probe a single host:port with a TCP connect, resolving within `timeoutMs`.
 * Returns true if the port is open.
 */
function tcpProbe(ip, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done     = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error',   () => finish(false));
    socket.connect(port, ip);
  });
}

/**
 * Derive the /24 subnet from the machine's primary non-loopback IPv4 interface.
 * Returns e.g. "192.168.86" or null if unavailable.
 */
function getLocalSubnet() {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address.split('.').slice(0, 3).join('.');
      }
    }
  }
  return null;
}

// GET /api/discover — scan /24 LAN for hosts with EXO port 52415 open
// Returns: [{ ip, port, reachable, modelCount }]
app.get('/api/discover', async (req, res) => {
  const exoPort   = 52415;
  const timeoutMs = 2000;

  const subnet = getLocalSubnet();
  if (!subnet) {
    return res.status(500).json({ error: 'Could not determine local subnet', nodes: [] });
  }

  // Build list of all 254 host addresses in the /24 subnet
  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);

  // Probe all in parallel
  const probes  = ips.map(ip => tcpProbe(ip, exoPort, timeoutMs).then(reachable => ({ ip, reachable })));
  const results = await Promise.all(probes);

  const reachable = results.filter(r => r.reachable);

  // For reachable nodes: query /v1/models to get model count
  const enriched = await Promise.all(reachable.map(async ({ ip }) => {
    let modelCount = 0;
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 2000);
      const r = await fetch(`http://${ip}:${exoPort}/v1/models`, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        modelCount = (data.data || data.models || []).length;
      }
    } catch (e) { /* unreachable or no /v1/models */ }
    return { ip, port: exoPort, reachable: true, modelCount };
  }));

  console.log(`[discover] subnet=${subnet}.0/24 — found ${enriched.length} EXO node(s)`);
  res.json(enriched);
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket.io] Client connected: ${socket.id}`);

  // Send current download state on connect so the UI can restore in-flight downloads
  const dlList = Object.values(activeDownloads).map(({ _child, lastStderr, ...rest }) => rest);
  socket.emit('downloads:current', dlList);

  socket.on('disconnect', () => {
    console.log(`[socket.io] Client disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

const settings = getSettings();

// ─── Plugin loader (optional) ───────────────────────────────────────────────
const pluginDir = path.join(__dirname, '..', 'plugins');
if (fs.existsSync(pluginDir)) {
  fs.readdirSync(pluginDir)
    .filter(d => fs.existsSync(path.join(pluginDir, d, 'index.js')))
    .forEach(d => {
      try {
        const plugin = require(path.join(pluginDir, d, 'index.js'));
        plugin({ app, io, server, sshExec, getSettings, saveSettings, getExoNodes });
        console.log(`  Plugin loaded: ${d}`);
      } catch (e) { console.error(`  Plugin error (${d}):`, e.message); }
    });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ExoScopy v${settings.version || '1.0.0'}`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://0.0.0.0:${PORT} (LAN)\n`);
  console.log(`  EXO nodes: ${getExoNodes().map(n => n.name).join(', ')}`);
  console.log(`  Downloads: ${Object.keys(activeDownloads).length} restored\n`);
});
