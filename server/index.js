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

const { getSettings, saveSettings } = require('./settings');
const { scanAllNodes }                          = require('./scanner');
const {
  listConversations, getConversation, createConversation,
  updateConversation, deleteConversation, addMessage,
  startInference, appendInferenceContent, finishInference,
  getInferenceStatus, clearInference,
} = require('./conversations');

// ─── Express + Socket.IO bootstrap ───────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = 3456;

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/settings — return current settings
app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

// PUT /api/settings — update settings (partial merge)
app.put('/api/settings', (req, res) => {
  try {
    const current = getSettings();
    const update  = req.body;

    // Validate nodes array (0-10 elements, each needs name + ip)
    if (update.nodes) {
      if (!Array.isArray(update.nodes) || update.nodes.length > 10) {
        return res.status(400).json({ error: 'nodes must be an array of 0-10 elements' });
      }
      for (const n of update.nodes) {
        if (!n.name || !n.ip) {
          return res.status(400).json({ error: 'Each node needs name and ip' });
        }
        // Ensure paths.exo has a default
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

// POST /api/monitoring/purge — delete all EXO instances via DELETE /instance/:id
app.post('/api/monitoring/purge', async (req, res) => {
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

// POST /api/monitoring/load — load a model on the EXO cluster via place_instance
// body: { modelId, sharding?, minNodes? }
app.post('/api/monitoring/load', async (req, res) => {
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

// DELETE /api/monitoring/instance/:instanceId — unload a specific EXO instance
app.delete('/api/monitoring/instance/:instanceId', async (req, res) => {
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
  const destPath   = settings.source.paths.exo;
  const sshUser    = settings.source.sshUser;
  const sourceIp   = settings.source.ip;
  const sshOpts    = settings.sshOpts;
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
dest="${localDir}"
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
// body: { modelId: 'mlx-community/ModelName' }
app.post('/api/download', (req, res) => {
  const { modelId } = req.body;
  if (!modelId || !modelId.includes('/')) {
    return res.status(400).json({ error: 'modelId must be in format community/model-name' });
  }
  const downloadId = startDownload(modelId);
  res.json({ downloadId, modelId, status: activeDownloads[downloadId]?.status || 'started' });
});

// GET /api/downloads — list all downloads (strip internal fields)
app.get('/api/downloads', (req, res) => {
  const list = Object.values(activeDownloads).map(({ _child, lastStderr, ...rest }) => rest);
  res.json(list);
});

// POST /api/download/cancel/:id — stop an active or queued download
app.post('/api/download/cancel/:id', (req, res) => {
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
app.delete('/api/download/:id', (req, res) => {
  const dl = activeDownloads[req.params.id];
  if (!dl) return res.status(404).json({ error: 'Download not found' });
  if (dl._child) { dl._child.kill('SIGTERM'); dl._child = null; }
  delete activeDownloads[req.params.id];
  io.emit('download:removed', { id: req.params.id });
  saveDownloads();
  res.json({ ok: true });
});

// POST /api/download/restart/:id — restart a stopped/errored download
app.post('/api/download/restart/:id', (req, res) => {
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
// CONVERSATIONS API
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/conversations — lightweight list (no full messages)
app.get('/api/conversations', (req, res) => {
  res.json(listConversations());
});

// GET /api/conversations/:id — full conversation + inference status
app.get('/api/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const inference = getInferenceStatus(req.params.id);
  res.json({ ...conv, inference });
});

// POST /api/conversations — create new conversation
app.post('/api/conversations', (req, res) => {
  const conv = createConversation(req.body);
  res.json(conv);
});

// PUT /api/conversations/:id — update (rename, pin, etc.)
app.put('/api/conversations/:id', (req, res) => {
  const conv = updateConversation(req.params.id, req.body);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

// DELETE /api/conversations/:id
app.delete('/api/conversations/:id', (req, res) => {
  const ok = deleteConversation(req.params.id);
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
  const settings = getSettings();
  const cfg      = (settings.chat || {})[engine];
  const ip = cfg?.ip || settings.nodes?.[0]?.ip;
  const port = cfg?.port || settings.exoPort || 52415;
  if (!ip) return null;
  return `http://${ip}:${port}`;
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
  const base   = getChatEndpoint(engine);
  if (!base) return res.json({ activeModel: null });

  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 4000);
    const r    = await fetch(`${base}/state`, { signal: controller.signal });
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

// GET /api/chat/models?engine=exo1 — models available via exo /v1/models (HTTP, no SSH)
app.get('/api/chat/models', async (req, res) => {
  const engine = req.query.engine || 'exo1';
  const base   = getChatEndpoint(engine);
  if (!base) return res.status(400).json({ error: `Unknown engine: ${engine}` });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${base}/v1/models`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.json({ engine, models: [], error: `HTTP ${r.status}` });
    const data = await r.json();
    const models = (data.data || []).map(m => ({ id: m.id, name: m.id })).sort((a, b) => a.id.localeCompare(b.id));
    res.json({ engine, models });
  } catch (e) {
    res.json({ engine, models: [], error: e.message });
  }
});

// POST /api/chat/completions — proxy to EXO with SSE streaming + background persistence
app.post('/api/chat/completions', async (req, res) => {
  const {
    engine, model, messages, temperature, max_tokens, stream, thinking,
    top_p, top_k, min_p, repetition_penalty, seed, reasoning_effort,
    conversationId,
  } = req.body;

  const base = getChatEndpoint(engine || 'exo1');
  if (!base) return res.status(400).json({ error: `Unknown engine: ${engine}` });

  const isStreaming = stream !== false;

  // Build request body — EXO-only params
  const body = {
    model,
    messages: [...messages],
    stream: isStreaming,
  };
  if (isStreaming)           body.stream_options      = { include_usage: true };
  if (temperature != null)   body.temperature         = temperature;
  if (max_tokens  != null)   body.max_tokens          = max_tokens;
  if (thinking)              body.enable_thinking     = true;
  if (top_p       != null)   body.top_p               = top_p;
  if (top_k       != null)   body.top_k               = top_k;
  if (min_p       != null)   body.min_p               = min_p;
  if (repetition_penalty != null) body.repetition_penalty = repetition_penalty;
  if (seed        != null)   body.seed                = seed;
  if (thinking && reasoning_effort) body.reasoning_effort = reasoning_effort;

  console.log(`[chat] engine=${engine} model="${model}" conv=${conversationId || 'none'} stream=${body.stream} → ${base}/v1/chat/completions`);

  // Persist user message
  if (conversationId) {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg?.role === 'user') {
      addMessage(conversationId, 'user', lastUserMsg.content);
    }
    startInference(conversationId);
  }

  try {
    const fetchRes = await fetch(`${base}/v1/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer x' },
      body:    JSON.stringify(body),
    });

    if (!fetchRes.ok) {
      let errBody = '';
      try { errBody = await fetchRes.text(); } catch (e) {}
      console.error(`[chat] Upstream ${fetchRes.status}: ${errBody}`);
      if (conversationId) finishInference(conversationId, errBody);
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

            if (conversationId) {
              for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const delta  = parsed.choices?.[0]?.delta?.content;
                  if (delta) appendInferenceContent(conversationId, delta);
                } catch (e) { /* not JSON */ }
              }
            }
          }
        } catch (e) {
          console.error(`[chat] Stream error: ${e.message}`);
          if (conversationId) finishInference(conversationId, e.message);
        }
        if (conversationId) finishInference(conversationId);
        if (clientConnected) { try { res.end(); } catch (e) {} }
      };
      pump();

    } else {
      const data = await fetchRes.json();
      if (conversationId && data.choices?.[0]?.message?.content) {
        addMessage(conversationId, 'assistant', data.choices[0].message.content);
        finishInference(conversationId);
      }
      res.json(data);
    }
  } catch (e) {
    if (conversationId) finishInference(conversationId, e.message);
    res.status(502).json({ error: `Engine unreachable: ${e.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HUGGINGFACE HUB SEARCH
// ─────────────────────────────────────────────────────────────────────────────

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
      if (tags.includes('mlx'))  detectedFormat = 'mlx';
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

    res.json(results);
  } catch (e) {
    console.error('[hub/search]', e.message);
    res.status(500).json({ error: e.message });
  }
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ExoScopy v${settings.version || '1.0.0'}`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://0.0.0.0:${PORT} (LAN)\n`);
  console.log(`  EXO nodes: ${getExoNodes().map(n => n.name).join(', ')}`);
  console.log(`  Downloads: ${Object.keys(activeDownloads).length} restored\n`);
});
