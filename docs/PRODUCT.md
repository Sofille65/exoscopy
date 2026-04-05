# ExoScopy — Product Description
## Complete UX/UI Reference Document

> Version 1.1 — 2026-04-04
> For UX/UI design work (Paper)

---

## 1. Vision & Positioning

**ExoScopy** is a web-based cluster dashboard for [exo](https://github.com/exo-explore/exo) — the open-source framework that turns a network of Apple Silicon Macs into a unified distributed AI inference engine.

**The problem it solves**: exo is a powerful inference framework with a minimal debug-style dashboard (monospace yellow/black). Users running multi-node clusters have no real product-grade UI to manage their cluster, chat with models, or handle model distribution.

**The solution**: ExoScopy is a zero-configuration dashboard that auto-discovers exo nodes on the local network, provides a clean product-quality interface for chat, monitoring, and model management — including downloading models from HuggingFace and distributing them across nodes via LAN.

**Tagline**: *See your cluster. Run your models.*

**Design benchmark**: Inferencer Pro (native macOS app on App Store) — clean, readable, professional. ExoScopy aims for that level of polish as a web app.

---

## 2. Target Users

### Primary: Home Lab / Research Cluster Operators
- Own 2–8 Apple Silicon Macs networked over Thunderbolt 5, 10GbE or standard Ethernet
- Run exo for local inference (privacy, no API cost, large models)
- Technical but not necessarily sysadmin experts
- Value: visual monitoring, one-click model loading, performance visibility

### Secondary: Prosumer / Studio Operators
- Small AI studios with dedicated Mac Studio racks
- Need: uptime monitoring, model management workflow
- Value: professional dashboard, shareable metrics

### Tertiary: exo contributors / community
- Want to demo exo capabilities
- Value: the topology view as a visual showcase of what exo does

---

## 3. Core Principles

1. **Zero config by default** — auto-discovery on first launch, no config file to hand-edit
2. **EXO-native** — exposes exo's own API concepts (instances, sharding, RDMA) directly
3. **Live by default** — everything updates in real time (10s polling + Socket.IO for downloads/sync)
4. **Light, clean, readable** — inspired by Inferencer Pro; white background, good typography, professional feel
5. **Real navigation** — proper page routing with persistent nav, not modals stacked on a dashboard

---

## 4. Application Structure

### Navigation

Persistent top or side navigation bar with page routing:

```
[ExoScopy logo] [v1.0.0]                    [cluster status badge]

[Dashboard]  [Chat]  [Models]  [Downloads]  [Settings]
```

Each nav item leads to a full-page view. Active page highlighted.

### Pages

| Page | Purpose |
|------|---------|
| **Dashboard** | Cluster overview — Space View, node status, active model |
| **Chat** | Chat with models via exo API |
| **Models** | Models installed per node, sync between nodes, HF search & download |
| **Downloads** | Active downloads, queue, distribution progress |
| **Settings** | Node config, SSH, endpoints, setup wizard |

---

## 5. Screens — Detailed Descriptions

---

### 5.1 Navigation Bar

**Always visible.** Persistent across all pages.

**Left side:**
- ExoScopy logo/wordmark
- Version badge (`v1.0.0`, small, muted)

**Center or left — page links:**
- Dashboard, Chat, Models, Downloads, Settings
- Active page highlighted
- Downloads: badge with active count when downloads running

**Right side:**
- Cluster health badge: `N/M nodes online` (green = all, yellow = partial, red = none)
- Active model indicator: `⚡ ModelName` when a model is loaded
- Link to exo dashboard (`↗`) — opens exo's native web UI

---

### 5.2 Dashboard Page

The home page. Cluster overview at a glance.

#### 5.2.1 Space View (primary)

**The signature feature of ExoScopy.** SVG topology visualization showing cluster status.

- **Dynamic node layout** — adapts to 2–8 nodes (diamond for 4, line for 2, grid for more)
- **Connection lines** between node pairs:
  - Indigo solid = RDMA active (both nodes running)
  - Gray solid = available (both online, not running)
  - Dark dashed = inactive
- **Node circles** (R=34):
  - Border color: green (running) / yellow (online, stopped) / red (offline)
  - **Glow effect**: green radial blur when running (`feGaussianBlur stdDeviation=9`, opacity 0.45)
  - Center: node short name
  - Below: RAM%, IP, GPU% · temp° · watts
- **Legend**: connection types
- **Active model strip**: `⚡ ModelName [Nn] [× Unload]` when a model is loaded

Focus: **status visibility**. For advanced topology configuration, link to exo's native dashboard.

#### 5.2.2 Node Cards (below Space View)

Compact cards for each node, showing:
- Node name + IP
- Status pill: `Online` (green) / `Stopped` (yellow) / `Offline` (red)
- RAM usage bar (used/total %)
- GPU% / Temperature / Power
- Model count on this node

---

### 5.3 Chat Page

Full-page chat interface. Two-column layout.

#### Layout:
```
┌──────────────┬──────────────────────────────────────────┐
│ Sidebar      │ Messages                                 │
│              │                                          │
│ Conversations│ [message thread with streaming]           │
│ list         │                                          │
│              │                                          │
│ [+ New]      │ [model selector] [params] [input bar]    │
└──────────────┴──────────────────────────────────────────┘
```

#### Model bar (top of messages):
```
[ModelName ▾]  [Presets: Creative | Normal | Code]  [Params ▾]
```
- Model selector: dropdown of models on disk (⚡ = active/loaded model)
- Presets: one-click parameter sets
- Params panel (collapsible):

**Params — Row 1:**
- Temperature (slider 0–2, default 0.7)
- Max tokens (input, default 32768)
- Thinking toggle (ON/OFF)
- Reasoning effort (none/minimal/low/medium/high/xhigh) — visible when thinking ON

**Params — Row 2 (exo-specific):**
- top_p (0–1)
- top_k (int)
- min_p (0–0.5)
- Repetition penalty (1–2) — always paired with repetition_context_size
- Seed (int, optional)

**System prompt**: textarea with ON/OFF toggle, persisted in settings.

#### Messages:
- User: right-aligned or distinct background
- Assistant: left-aligned, Markdown rendered (via marked.js local)
- Thinking blocks (`<think>...</think>`): collapsible, muted style
- Streaming: animated cursor during generation
- Per-message stats: TTFT, speed (tk/s), token count
- Edit button on user messages → multi-turn editing (truncate + regenerate)

#### Input bar:
- Text area (auto-resize)
- 📎 Attach files (multi-file support)
- File badges (name + size + ✕) when attached
- Send button (active if text or file attached)

#### Sidebar:
- Conversations list (pinned first, then by date)
- Per-conversation: title, last message preview, timestamp
- Actions: rename, pin/unpin, delete, export (Markdown / JSON)
- `+ New conversation` button
- Search conversations

#### Save code blocks:
- 💾 button per code block in assistant responses
- 📦 Save all (.zip) when multiple code blocks

---

### 5.4 Models Page

Full-page model management. **The operational hub for model distribution.**

#### 5.4.1 Model Matrix

Table/grid showing models × nodes:

```
Model                    | Node A    | Node B    | Node C    | Node D
─────────────────────────|───────────|───────────|───────────|──────────
Qwen3.5-397B-9bit (415GB)| ✓ 415GB  | ✓ 415GB   | ✓ 415GB   | ✗ —
DeepSeek-V3.2-8bit       | ✓ 704GB  | ✓ 704GB   | ✓ 704GB   | ✓ 704GB
Kimi-K2.5 (612GB)        | ✓ 612GB  | ✗ —       | ✗ —       | ✗ —
```

- ✓ = installed (with size), ✗ = not installed
- ⚡ badge on currently loaded/active model
- Per-node: disk free shown in column header

#### 5.4.2 Model Actions

Per-model row actions:
- **Sync** → distribute from a node that has it to nodes that don't (rsync via SSH)
- **Delete** → remove from selected nodes
- **Load** → load on cluster (sharding strategy: Tensor/Pipeline)
- **Unload** → purge instance

Sync action opens inline detail:
- Source node (auto-selected: first node that has it)
- Target nodes (checkboxes, pre-checked: nodes that don't have it)
- `▶ Start sync` button
- Progress per target node (from Socket.IO events)

#### 5.4.3 Download New Model

Button or section to search and download from HuggingFace:

- **Search bar**: text input + format filter (MLX / GGUF / All) + sort
- **Results**: model cards with name, format, quant, size estimate, downloads count
- **Download action**: choose target node → start download → appears in Downloads page
- After download completes on one node → option to sync to other nodes

#### 5.4.4 Node Storage Summary

Per-node storage info:
- Disk used / total / free
- Model count
- Largest model

---

### 5.5 Downloads Page

Full-page view of download and distribution activity.

#### Active Downloads (status = 'downloading'):
- Model name + HF repo link
- Target node
- Progress bar (downloaded / total GB, percentage)
- Speed (MB/s)
- Files remaining count
- `■ Stop` button

#### Distribution (status = 'distributing'):
- Model name
- Source node → target nodes
- Progress per target node
- Speed (MB/s)

#### Queued (status = 'queued'):
- Model name
- Position in queue (#1, #2...)
- `✕ Cancel` button

#### History (status = done/stopped/error):
- Model name
- Status badge (✓ Done / ⚠ Stopped / ✕ Error)
- `↺ Restart` (if stopped/error) / `🗑 Remove`

**Queue info**: "N/3 slots used" badge.

**Empty state**: "No downloads. Go to Models to search HuggingFace →"

---

### 5.6 Settings Page

Full-page settings with sections.

#### 5.6.1 First-Run Setup Wizard

Shown when `setupComplete = false`. Full-page overlay.

**Step 1 — Welcome**
- ExoScopy logo
- "Welcome to ExoScopy"
- Brief description
- `→ Set up my cluster` button

**Step 2 — Node Discovery**
- "Scanning for exo nodes on your network..."
- Animated scan indicator
- Results: discovered nodes with IP, port, reachable status, model count
- `+ Add manually` (manual IP entry)
- `→ Continue` once at least 1 node selected

**Step 3 — SSH Setup**
- Guide for enabling SSH on each node (macOS: System Settings → Remote Login)
- SSH key generation or selection
- Test connectivity per node (✓ or ✗)
- `✓ Complete setup` button

#### 5.6.2 Settings (ongoing)

**Section: EXO Nodes**
- Table of configured nodes: name, IP, RAM, status, actions (edit, remove)
- `+ Add node` button
- `🔍 Re-discover` button (re-scan LAN)

**Section: EXO Endpoint**
- IP + port for the exo API (default: first discovered node, port 52415)
- `Test` button (checks /v1/models response)

**Section: SSH**
- SSH user
- SSH key path
- Test connectivity button per node

**Section: System Prompt**
- Textarea for default system prompt
- ON/OFF toggle
- Applied to all new conversations

**Section: About**
- Version
- Link to GitHub
- Link to exo GitHub
- Link to exo dashboard

---

## 6. Key User Flows

### 6.1 First-Run Setup
```
Open ExoScopy → Setup Wizard → Scan LAN → Select nodes → SSH setup → Done → Dashboard
```

### 6.2 Load a Model
```
Dashboard → see cluster status → Load Model → Select model → Tensor/Pipeline → Load
→ Space View: glow appears on nodes → ⚡ badge in nav
```

### 6.3 Chat with Active Model
```
Nav → Chat → Model auto-selected (⚡ current) → Type message → Send
→ Stream tokens → Markdown rendered → Conversation saved
```

### 6.4 Download and Distribute a New Model
```
Nav → Models → Search HF "qwen3" → filter MLX → Download to Node A
→ Nav → Downloads → see progress → download complete
→ Nav → Models → see model on Node A only → Sync → select other nodes → Start
→ rsync distributes via LAN → all nodes have model → ready to load
```

### 6.5 Monitor Cluster Health
```
Nav → Dashboard → Space View → see GPU%/temp/watts per node
→ glow = running, connections show RDMA status
→ need more detail? → click "exo dashboard ↗" link
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
  "exoEndpoint": { "ip": "192.168.1.10", "port": 52415 },
  "chat": {
    "exo": { "name": "EXO", "ip": "192.168.1.10", "port": 52415 }
  },
  "sshUser": "admin",
  "sshKeyPath": "/root/.ssh/id_ed25519",
  "systemPrompt": "",
  "systemPromptEnabled": false
}
```

### Downloads (persisted in `data/downloads.json`)
- In-memory Map + JSON persistence
- Survives Docker restarts (in-progress → restored as stopped)

### Conversations (persisted in `data/conversations.json`)
- Full message history per conversation
- Sorted: pinned first, then by updatedAt

### Runtime (in-memory only)
- `activeDownloads` Map
- `downloadQueue` array
- Active inference Map (for background streaming)
- Socket.IO connections

---

## 8. API Endpoints

### Settings & Discovery
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Current settings |
| PUT | `/api/settings` | Save settings |
| GET | `/api/discover` | Scan LAN for EXO nodes on port 52415 |

### Monitoring
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/monitoring/status` | Node status (online, process running) |
| GET | `/api/monitoring/ram` | RAM usage per node |
| GET | `/api/monitoring/info/:name` | Node detail |
| GET | `/api/monitoring/exo-node-metrics` | GPU%, temp, watts per node |
| GET | `/api/monitoring/exo-models` | Models on ALL EXO nodes |
| POST | `/api/monitoring/load` | Load model (place_instance) |
| DELETE | `/api/monitoring/instance/:id` | Unload instance |

### Models & Sync
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/models` | Models per node (matrix view data) |
| POST | `/api/models/sync` | Start rsync distribution between nodes |
| GET | `/api/models/sync/progress` | Sync progress (Socket.IO events) |
| POST | `/api/models/delete` | Delete model from nodes |

### Downloads
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/download` | Start HF download (or queue) |
| GET | `/api/downloads` | All downloads (active + history) |
| POST | `/api/download/cancel/:id` | Stop / cancel |
| DELETE | `/api/download/:id` | Remove from list |
| POST | `/api/download/restart/:id` | Restart stopped download |
| GET | `/api/hub/search` | Search HuggingFace Hub |

### Chat
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/models` | Models on disk |
| GET | `/api/chat/active-model` | Currently loaded model |
| POST | `/api/chat/completions` | Streaming chat proxy (SSE) |

### Conversations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create conversation |
| GET | `/api/conversations/:id` | Get conversation |
| PUT | `/api/conversations/:id` | Update (rename, pin) |
| DELETE | `/api/conversations/:id` | Delete |
| GET | `/api/conversations/:id/inference` | Inference status |

---

## 9. Real-Time Events (Socket.IO)

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `download:progress` | Server → Client | `{ id, modelId, progress, status, speed }` | Download progress |
| `download:complete` | Server → Client | `{ id, modelId, status }` | Download finished |
| `download:queued` | Server → Client | `{ id, modelId, position }` | Added to queue |
| `sync:progress` | Server → Client | `{ modelId, node, progress, speed }` | Rsync distribution progress |
| `sync:complete` | Server → Client | `{ modelId, node, status }` | Rsync to node finished |

---

## 10. Design Guidelines

### Look & Feel
**Inspired by Inferencer Pro** — clean, readable, professional.
Light theme with white/light gray backgrounds, clear typography, good contrast.

### Color Palette

| Element | Color | Usage |
|---------|-------|-------|
| Background | `#ffffff` / `#f9fafb` | Page background |
| Surface | `#ffffff` | Cards, panels |
| Border | `#e5e7eb` (`gray-200`) | Card borders, dividers |
| Text primary | `#111827` (`gray-900`) | Headings, labels |
| Text secondary | `#6b7280` (`gray-500`) | Metadata, IPs, timestamps |
| EXO / primary | `#6366f1` (`indigo-500`) | Primary accent, RDMA active |
| Active / online | `#10b981` (`emerald-500`) | Running nodes, glow, success |
| Warning | `#eab308` (`yellow-500`) | Partial states |
| Error / offline | `#ef4444` (`red-500`) | Offline, error |
| Download | `#3b82f6` (`blue-500`) | Download progress |

### Typography
- **UI text**: system sans-serif (`ui-sans-serif, -apple-system, sans-serif`)
- **Monospace** (IPs, model IDs, metrics): `ui-monospace, 'SF Mono', monospace`
- **Sizes**: 12–14px for dense UI elements, 18–24px for page headers

### Component Patterns
- **Status pills**: small, rounded-full, subtle background color
- **Action buttons**: clean, minimal borders, colored on hover
- **Progress bars**: thin (3–4px height), rounded, colored by threshold
- **Cards**: white background, subtle border, slight shadow on hover
- **Tables**: clean rows with hover highlight, no heavy borders
- **Nav**: horizontal top bar, clean active state indicator

### Space View Node Design
- Circle R=34px, white fill, colored stroke (2.5px)
- **Glow**: filled circle same color, opacity 0.45, `feGaussianBlur stdDeviation=9`
- Node name: 14px bold
- RAM %: 13px, color-coded
- IP: 11px muted monospace
- Metrics: 11px monospace

### Interaction States
- Hover: subtle background change, border emphasis
- Active: clear highlight, not just opacity change
- Loading: subtle pulse or skeleton, no heavy spinners
- Disabled: muted, cursor-not-allowed

---

## 11. v1.1 (Post-Launch)

- **Benchmark panel** — measure TTFT + tokens/sec on the cluster
- **Dark mode** toggle (light default, dark optional)
- **Keyboard shortcuts** (Cmd+Enter send, Cmd+K new chat)
- **Search across conversations**
- **Node reboot from UI**
- **HuggingFace model library** — browse installed models with disk usage details

---

## 12. Future (v1.2+)

- **Space View for arbitrary topologies** — dynamic layout for 2–8+ nodes
- **Multi-cluster** — multiple exo clusters from one dashboard
- **Alerting** — webhook/notification when node goes offline
- **Mobile responsive** — CSS-only adaptation for tablet/phone
- **PWA support** — Add to Home Screen, service worker
- **Metrics history** — time-series graphs (GPU%, RAM, tok/s over time)
- **SwiftUI companion app** — native macOS/iOS (v2 roadmap)

---

## 13. Technical Constraints

- **Backend**: Node.js 20 + Express + Socket.IO
- **Frontend**: React 18 (Babel CDN transform, no build step) — single `index.html`
- **CSS**: Tailwind CDN
- **Deployment**: Docker (`node:20-alpine`), port 3456
- **SSH**: All node operations via SSH (key mounted in Docker)
- **EXO API**: OpenAI-compatible + exo extensions at `http://<node>:52415`
- **No database**: JSON files in Docker volume (`data/`)
- **No authentication**: LAN-only, no auth in v1
- **marked.js**: local copy in `public/`, not CDN
