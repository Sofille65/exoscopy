# ExoScopy — Product Description
## Complete UX/UI Reference Document

> Version 1.0 — 2026-03-28
> For UX/UI design work (Stitch)

---

## 1. Vision & Positioning

**ExoScopy** is a web-based cluster dashboard for [exo](https://github.com/exo-explore/exo) — the open-source framework that turns a network of Apple Silicon Macs into a unified distributed AI inference engine.

**The problem it solves**: exo has no management UI. Users running multi-node clusters (2–8 Mac Studios, Mac Minis, MacBook Pros) have no way to visualize their topology, see live metrics, load/unload models, or run benchmarks without SSH and CLI tools.

**The solution**: ExoScopy is a zero-configuration dashboard that auto-discovers exo nodes on the local network, displays the cluster as a live topological map, and provides all cluster management operations through a clean UI.

**Tagline**: *See your cluster. Run your models.*

---

## 2. Target Users

### Primary: Home Lab / Research Cluster Operators
- Own 2–8 Apple Silicon Macs networked over Thunderbolt 5, 10GbE or standard Ethernet
- Run exo for local inference (privacy, no API cost, large models)
- Technical but not necessarily sysadmin experts
- Value: visual monitoring, one-click model loading, performance visibility

### Secondary: Prosumer / Studio Operators
- Small AI studios with dedicated Mac Studio racks
- Need: uptime monitoring, model management workflow, benchmarking for model selection
- Value: professional dashboard, shareable metrics

### Tertiary: exo contributors / community
- Want to demo exo capabilities
- Value: the topology view as a visual showcase of what exo does

---

## 3. Core Principles

1. **Zero config by default** — auto-discovery on first launch, no config file to hand-edit
2. **EXO-native** — exposes exo's own API concepts (instances, sharding, RDMA) directly, no abstraction layer
3. **Live by default** — everything updates in real time (10s polling + Socket.IO for downloads)
4. **Single-page, modal-based** — all panels are modals over a persistent dashboard; no navigation/routing
5. **Dark, dense, technical** — designed for power users who keep it open in a side monitor

---

## 4. Application Structure

```
┌─────────────────────────────────────────────────────────┐
│  Header bar (persistent)                                 │
│  [ExoScopy logo] [v1.0.0]    [⚡][📚][💬][⬇][⚙]        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Dashboard (main view)                                   │
│  ┌──────────┐  ┌──────────────────────────────────────┐ │
│  │  Source   │  │  Nodes                               │ │
│  │  card     │  │  [node1] [node2] [node3] [node4]     │ │
│  │           │  │  model list per node                 │ │
│  └──────────┘  └──────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘

Modals (z-layered, open over dashboard):
  ⊞ Monitoring  —  Space View + Grid View
  ⚡ Benchmark
  📚 Catalogue
  💬 Chat
  ⬇ Downloads
  🔍 Hub Search
  ⚙ Settings + Setup Wizard
```

---

## 5. Screens — Detailed Descriptions

---

### 5.1 Header Bar

**Always visible.** Fixed top bar, dark background.

**Left side:**
- ExoScopy logo/wordmark
- Version badge (`v1.0.0`, small, muted)
- Cluster health badge: `N/M nodes active` (green = all active, yellow = partial, red = none)

**Right side — icon buttons (left to right):**
| Icon | Label | Opens |
|------|-------|-------|
| ⚡ | Benchmark | BenchmarkPanel modal |
| 📚 | Catalogue | CataloguePanel modal |
| 💬 | Chat | ChatPanel modal |
| ⬇ | Downloads | DownloadPanel modal — badge with active count |
| 🔍 | Hub | HubSearchPanel modal |
| 👁 | Monitoring | MonitoringPanel modal |
| ⚙ | Settings | SettingsPanel modal |

**Download badge**: When downloads are active, a count badge appears on the ⬇ button.

---

### 5.2 Dashboard (Main View)

The persistent background view. Always visible behind modals.

#### 5.2.1 Source Card (left)
Represents the model storage source (the machine that holds the master copy of models).

- Node name + IP
- Online/offline indicator
- Disk used / total (progress bar)
- List of models stored (name, size, format badge)
- **Sync button** per model → distribute to selected nodes

#### 5.2.2 Node Cards (right, grid)
One card per EXO node. 2–4 columns depending on node count.

Each card contains:
- Node name (e.g. "ultra-512") + IP
- RAM badge (e.g. "512 GB")
- Status pill: `EXO running` (green) / `EXO stopped` (yellow) / `Offline` (red)
- RAM usage bar (used/total %)
- List of models on this node
  - Name, size
  - `⚡` badge if currently loaded/active
- Per-model action: sync from source / remove

---

### 5.3 Monitoring Panel

Full-screen modal. Header with env tabs (EXO only in v1), status badge, action buttons.

**Header bar:**
- `EXO` tab (active/only tab in v1)
- Status badge: `4/4 active` / `2/4 active` / `0/4 active`
- `Auto-refresh` toggle (10s interval)
- `▶ Start All` / `■ Stop All` / `🗑 Purge instances` buttons
- `⊕ Load Model` button
- `EXO Dashboard ↗` external link to exo's native web UI
- `◈ Space / ⊞ Grid` view toggle
- `Refresh` button + `✕` close

**Active Instance Strip** (below header, visible when model loaded):
```
⚡ ModelName  [4n]  [×]
```
Shows currently loaded model, node count, unload button.

#### 5.3.1 Grid View (default)

Node card grid (2–4 columns).

Each node card shows:
- Node name + IP
- Status indicator (color dot + text)
- RAM bar: `used GB / total GB (pct%)`
- `▶ Start` / `■ Stop` button per node
- `ⓘ` info button → node detail modal

#### 5.3.2 Space View

**The signature feature of ExoScopy.** SVG diamond topology visualization.

- 4 nodes arranged in a diamond (top, left, right, bottom)
- **Connection lines** between all node pairs:
  - Indigo solid = RDMA active (both nodes running)
  - Gray solid = RDMA available (both online, not running)
  - Dark dashed = Inactive
- **Node circles** (R=34):
  - Border color: green (running) / yellow (online, stopped) / red (offline)
  - **Glow effect**: green radial blur when running
  - Center: node short name (e.g. "512", "256a")
  - Below name: RAM percentage (color-coded)
  - Below circle: IP address
  - Below IP: `GPU X% · XX° · XXXW` (from /state metrics)
  - RAM bar (mini progress bar)
- **Legend** (vertical, bottom-left): RDMA actif / RDMA dispo / Inactif

#### 5.3.3 Load Model Form

Inline form (appears below the active instance strip when Load Model is clicked):
- Dropdown: model selection (intersection of models present on ALL EXO nodes)
  - Shows model short name, format badge
  - `⚡` prefix if currently active
- Sharding toggle: `Tensor` / `Pipeline` (Tensor recommended)
- `Load` button (primary) / `Cancel`

#### 5.3.4 Node Info Modal

Sub-modal (z-layer above Monitoring):
- Node name, IP, RAM
- SSH connection status
- Disk usage
- EXO process details (PID, uptime if available)
- Model files present

---

### 5.4 Chat Panel

Full-screen modal. Three-column layout.

#### Layout:
```
┌──────────────┬────────────────────────────┬────────────────┐
│ Sidebar      │ Messages                   │ [collapsed by  │
│              │                            │  default]      │
│ Conversations│ [message bubbles]          │                │
│ list         │                            │                │
│              │                            │                │
│ + New        │ [input bar]                │                │
└──────────────┴────────────────────────────┴────────────────┘
```

#### Engine/Model bar (top of messages column):
```
[EXO ▾] [ModelName ▾] [Params ▾] [ℹ]
```
- Engine selector: one button per configured chat endpoint
- Model selector: dropdown of models on disk (⚡ = active model)
- Params panel (collapsible):

**Params — Row 1 (all engines):**
- Temperature (slider 0–2, default 0.7)
- Max tokens (input, default 32768)
- Thinking toggle (ON/OFF)
- Reasoning effort (none/minimal/low/medium/high/xhigh) — visible when thinking ON

**Params — Row 2 (exo-specific, indigo badge):**
- top_p (0–1)
- top_k (int)
- min_p (0–0.5)
- Repetition penalty (1–2)
- Seed (int, optional)

**ℹ Help panel**: inline description of each parameter.

#### Message bubbles:
- User: right-aligned, darker background
- Assistant: left-aligned, lighter background, Markdown rendered
- Thinking blocks (`<think>...</think>`): collapsible, muted style, italic
- Streaming: animated cursor during generation

#### Input bar:
- Text area (auto-resize)
- 📎 Attach file button
- File badge (name + size + ✕) when attached
- Send button (disabled when empty, unless file attached)

#### Sidebar:
- Conversations list (pinned first, then by date)
- Per-conversation: title, last message preview, timestamp
- Right-click / hover actions: rename, pin/unpin, delete
- `+ New conversation` button

---

### 5.5 Download Panel

Modal (max-w-3xl). Shows active downloads, queued downloads, and history.

#### Sections:

**Active Downloads** (status = 'downloading'):
- Model name
- Progress bar (downloaded / total GB, percentage)
- Speed (MB/s)
- Files remaining count
- `■ Stop` button

**Queued** (status = 'queued'):
- Model name
- Position in queue (#1, #2...)
- `✕ Cancel` button

**Completed / History** (status = done/stopped/error):
- Model name
- Status badge (✓ Terminé / ⚠ Arrêté / ✕ Erreur)
- `↺ Restart` (if stopped/error) / `🗑 Delete` (removes from list)

**Empty state**: "No downloads. Search HuggingFace to find models →"

Queue info: "3/3 slots used" badge when full.

---

### 5.6 Hub Search Panel

Modal. Search HuggingFace for models to download.

**Search bar**: text input + format filter (MLX / GGUF / All) + sort (downloads / likes / recent)

**Results list** (cards):
Each card:
- Model ID (e.g. `mlx-community/Qwen3-Coder-480B-8bit`)
- Author + model name
- Format badge (MLX / GGUF / safetensors)
- Quantization badge (8-bit / 4-bit / BF16 / FP16...)
- Parameter count (e.g. 72B, 397B)
- Estimated size (e.g. 42.3 GB)
- Downloads count (M/K)
- `⬇ Download` button → triggers download with env selection
- `🔗` External link to HuggingFace model page

**Download dialog** (appears inline on click):
- Target: always EXO (v1)
- Confirm button

---

### 5.7 Catalogue Panel

Modal. Curated list of recommended models for exo, organized by category.

**Filters bar**: env (EXO), tags (multiselect: coding, reasoning, creative, multilingual, vision...)

**Model cards** (compact list):
- Model name + short description
- Format / quant badge
- Size estimate
- Tags
- `⬇ Download` button
- `🔍 View on HF` link

**Categories** (visual dividers):
- Best overall
- Best for coding
- Best for reasoning / thinking
- Fast (optimized for speed)
- Large (flagship quality)

---

### 5.8 Benchmark Panel

Modal (compact, max-w-lg).

**Purpose**: Measure inference speed (TTFT + tokens/second) on the connected EXO cluster.

**Display:**
- Current model (auto-detected from /state, ⚡ badge)
- Prompt preview (fixed test prompt, 200-word creative writing task)
- Config summary: `400 tokens max · engine exo1 · streaming`

**Before run:**
- `▶ Lancer le benchmark` button

**During run (live metrics):**
- Tokens generated (count)
- Elapsed time (seconds, updates every 200ms)
- Speed (tok/s, live)
- Animated progress indicator

**After run (results grid):**
- Tokens/sec (large, green)
- Time to first token — TTFT (amber)
- Total tokens (indigo)
- Total time (gray)
- `↺ Relancer` button

---

### 5.9 Settings Panel

Modal. Two main sections: cluster configuration + advanced.

#### 5.9.1 First-Run Setup Wizard

Shown when `setupComplete = false`. Full-screen overlay.

**Step 1 — Welcome**
- ExoScopy logo
- "Bienvenue dans ExoScopy"
- Brief description
- `→ Configurer mon cluster` button

**Step 2 — Node Discovery**
- "Recherche des nodes exo sur votre réseau..."
- Animated scan indicator
- Results list: discovered nodes with IP, port, reachable indicator, model count
- `+ Ajouter manuellement` (manual IP entry)
- `→ Continuer` once at least 1 node selected

**Step 3 — Validation**
- Summary of selected nodes
- SSH connectivity check (✓ or ✗ per node)
- `✓ Terminer la configuration` button

#### 5.9.2 Settings (ongoing)

**Section: Nodes EXO**
- Table of configured nodes: name, IP, RAM, actions (edit, remove)
- `+ Add node` button (name + IP + RAM fields)
- `🔍 Redétecter` button (re-run LAN discovery)

**Section: Chat Endpoints**
- List of chat endpoints (maps to `settings.chat`)
- Per endpoint: name, IP, port, `Test` button (checks /v1/models response)
- `+ Add endpoint` button

**Section: SSH**
- SSH user (default: admin)
- SSH key path (default: /root/.ssh/id_ed25519)

**Section: About**
- Version
- Link to GitHub
- Link to exo GitHub

---

## 6. Key User Flows

### 6.1 First-Run Setup
```
Open ExoScopy → Setup Wizard → Scan LAN → Select nodes → SSH check → Done → Dashboard
```

### 6.2 Load a Model
```
Monitoring → Space View → "Load Model" → Select model → Tensor/Pipeline → Load
→ Space View updates: glow appears on nodes → ⚡ badge in header
```

### 6.3 Chat with Active Model
```
Chat button → Chat panel → Model auto-selected (⚡ current) → Type message → Send
→ Stream tokens → Markdown rendered → Conversation saved
```

### 6.4 Download a New Model
```
Hub Search → search "qwen3" → filter MLX → find model → ⬇ Download
→ Download panel shows progress → queue if 3 active → auto-start when slot free
```

### 6.5 Benchmark
```
Load model in Space View → ⚡ Benchmark button → Launch → See live tok/s → Compare
```

### 6.6 Monitor Cluster Health
```
Monitoring → Space View → see GPU%/temp/watts per node → glow = active
→ Connections: indigo = RDMA active, if line missing = node offline
```

---

## 7. Data & State Model

### Settings (persisted in `data/settings.json`)
```json
{
  "version": "1.0.0",
  "setupComplete": true,
  "nodes": [
    { "name": "ultra-512", "ip": "192.168.1.10", "ram": "512 GB" },
    { "name": "ultra-256a", "ip": "192.168.1.11", "ram": "256 GB" }
  ],
  "exoPort": 52415,
  "chat": {
    "exo1": { "name": "EXO", "ip": "192.168.1.10", "port": 52415 }
  },
  "sshUser": "admin",
  "sshOpts": "..."
}
```

### Downloads (persisted in `data/downloads.json`)
- In-memory Map + JSON persistence
- Survives Docker restarts (in-progress → restored as stopped)

### Conversations (persisted in `data/conversations.json`)
- Full message history
- Sorted: pinned first, then by updatedAt

### Runtime (in-memory only)
- `activeDownloads` Map
- `downloadQueue` array
- Active inference Map (for background streaming)
- Socket.IO connections

---

## 8. API Endpoints

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Current settings |
| PUT | `/api/settings` | Save settings |
| GET | `/api/discover` | Scan LAN for EXO nodes on port 52415 |

### Cluster State
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Full cluster state (sources + nodes + models) |
| GET | `/api/nodes` | Node list with models |

### Monitoring
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/monitoring/status` | Node status (online, processRunning) |
| GET | `/api/monitoring/ram` | RAM usage per node |
| GET | `/api/monitoring/info/:name` | Node detail |
| POST | `/api/monitoring/start` | Start EXO on nodes |
| POST | `/api/monitoring/stop` | Stop EXO on nodes |
| POST | `/api/monitoring/purge` | Purge all EXO instances |
| GET | `/api/monitoring/exo-node-metrics` | GPU%, temp, watts per node |
| GET | `/api/monitoring/exo-models` | Models on ALL EXO nodes |
| POST | `/api/monitoring/load` | Load model (place_instance) |
| DELETE | `/api/monitoring/instance/:id` | Unload instance |

### Downloads
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/download` | Start download (or queue) |
| GET | `/api/downloads` | All downloads (active + history) |
| POST | `/api/download/cancel/:id` | Stop / cancel |
| DELETE | `/api/download/:id` | Remove from list |
| POST | `/api/download/restart/:id` | Restart stopped download |

### Chat
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/engines` | Available chat endpoints |
| GET | `/api/chat/models` | Models on disk for engine |
| GET | `/api/chat/active-model` | Currently loaded model |
| POST | `/api/chat/completions` | Streaming chat proxy |

### Conversations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create conversation |
| GET | `/api/conversations/:id` | Get conversation |
| PUT | `/api/conversations/:id` | Update (rename, pin) |
| DELETE | `/api/conversations/:id` | Delete |
| GET | `/api/conversations/:id/inference` | Inference status |
| POST | `/api/conversations/:id/inference/clear` | Clear inference |

### Hub & Catalogue
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hub/search` | Search HuggingFace Hub |
| GET | `/api/catalog` | Curated catalogue |
| PUT | `/api/catalog` | Replace catalogue |
| POST | `/api/catalog` | Add model |
| DELETE | `/api/catalog/:id` | Remove model |

---

## 9. Real-Time Events (Socket.IO)

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `download:progress` | Server → Client | `{ id, modelId, progress, status, speed }` | Download progress update |
| `download:complete` | Server → Client | `{ id, modelId, status }` | Download finished |
| `download:queued` | Server → Client | `{ id, modelId, position }` | Download added to queue |

---

## 10. Design Guidelines (for Stitch)

### Color Palette

| Element | Color | Usage |
|---------|-------|-------|
| Background | `#030712` (`gray-950`) | App background |
| Surface | `#111827` (`gray-900`) | Modal, cards |
| Border | `#374151` (`gray-700`) | Card borders |
| Text primary | `#f9fafb` (`gray-50`) | Headings, labels |
| Text muted | `#6b7280` (`gray-500`) | Secondary text, IP, metadata |
| EXO / primary | `#6366f1` (`indigo-500`) | RDMA active, EXO brand accent |
| Active / online | `#10b981` (`emerald-500`) | Running nodes, glow |
| Warning | `#eab308` (`yellow-500`) | Partial states |
| Error / offline | `#ef4444` (`red-500`) | Offline, error |
| Download | `#6366f1` (`indigo-400`) | Download panel accent |
| Chat | `#06b6d4` (`cyan-400`) | Chat button |
| Benchmark | `#a855f7` (`purple-400`) | Benchmark accent |
| Catalogue | `#14b8a6` (`teal-400`) | Catalogue accent |

### Typography
- **UI text**: system sans-serif (`ui-sans-serif, -apple-system, sans-serif`)
- **Monospace** (IPs, model IDs, metrics): `ui-monospace, 'SF Mono', monospace`
- **Sizes**: 11–14px for dense UI elements, 16–18px for headers

### Component Patterns
- **Status pills**: small, rounded-full, 2px border, semi-transparent fill
- **Action buttons**: small (py-1 px-3), border + hover border glow
- **Progress bars**: thin (3–4px height), rounded, colored by threshold
- **Modal structure**: max-w-5xl, rounded-xl, border gray-700, shadow-2xl, overflow-y-auto
- **Icon buttons** (header): square, border, icon only, colored hover state

### Space View Node Design
- Circle R=34px, fill `#111827`, colored stroke (2.5px)
- **Glow**: filled circle same color, opacity 0.45, `feGaussianBlur stdDeviation=9`
- Node name: 14px bold white
- RAM %: 13px, color-coded (emerald/yellow/red)
- IP: 11px muted monospace
- Metrics (GPU/temp/watts): 11px `#9ca3af` monospace, `GPU X% · XX° · XXXW`

### Interaction States
- Hover: border opacity increase + slight background lightening
- Active/loading: opacity 0.5 + cursor-not-allowed on disabled buttons
- Loading states: "..." text replacement, no spinners (keeps it dense)

---

## 11. Not in v1 (Future)

- **Inferencer support** — Sophie's custom inference stack (separate project)
- **MLX Convert** — model quantization workflow
- **Model distribution** (rsync) — push models from source to nodes
- **Space View for arbitrary topologies** — currently hardcoded for 4-node diamond
- **Multi-cluster** — multiple exo clusters from one dashboard
- **Alerting** — webhook/notification when node goes offline
- **Mobile** — currently desktop-only (dense information density)
- **SwiftUI native app** — macOS native wrapper (future roadmap)
- **Metrics history** — time-series graphs (GPU%, RAM over time)

---

## 12. Technical Constraints

- **Backend**: Node.js 20 + Express + Socket.IO
- **Frontend**: Vanilla HTML/JS with React 18 (Babel CDN transform, no build step)
- **CSS**: Tailwind CDN
- **Deployment**: Docker (`node:20-alpine`), port 3456
- **SSH**: All node operations via SSH exec (same key as host mount)
- **EXO API**: OpenAI-compatible + exo extensions at `http://<node>:52415`
- **No database**: JSON files in Docker volume (`data/`)
- **No authentication**: LAN-only, no auth in v1
