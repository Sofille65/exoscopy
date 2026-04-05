# ExoScopy — Design Document

> A clean, open-source web client for [exo](https://github.com/exo-explore/exo) clusters.
> Chat, monitor, and manage your distributed LLM inference from a single dashboard.

---

## Vision

ExoScopy is a lightweight web dashboard for exo — the distributed AI inference engine. It gives you a clean interface to chat with your models, monitor your cluster health, and manage model loading across nodes.

No cloud. No accounts. Just your hardware.

---

## Target Users

- Home lab enthusiasts running exo on Mac Studio / Mac Pro clusters
- Small teams self-hosting LLMs on Apple Silicon
- Anyone running exo who wants more than the built-in web UI

---

## Core Features

### 1. Chat

The primary interface. Talk to your models through exo's OpenAI-compatible API.

- **Multi-model chat** — pick any model loaded on your cluster
- **Streaming responses** — real-time token-by-token display
- **Conversation history** — persistent, searchable sidebar
- **System prompt** — global or per-conversation, with ON/OFF toggle
- **Parameter presets** — Creative / Normal / Code (one click)
- **Advanced params** — temperature, top_p, top_k, min_p, max_tokens, seed
- **Thinking mode** — native `enable_thinking` + `reasoning_effort` for supported models (Qwen3.5, etc.)
- **File attachments** — paste code files for context (.py, .js, .md, .json, .sh, ...)
- **Export** — download conversation as Markdown or JSON
- **Multi-turn editing** — edit any previous message, regenerate from that point
- **Per-conversation stats** — TTFT, speed (tk/s), token counts, generation time

### 2. Cluster Monitoring

Live view of your exo cluster state.

- **Node grid** — all nodes with status (online/offline), RAM usage, IP
- **Space View** — SVG topology diagram showing RDMA/network mesh between nodes
- **GPU metrics** — temperature, power draw, GPU utilization per node (from exo `/state`)
- **Active model** — which model is loaded, on which nodes, shard assignments
- **Runner status** — Connected / Loading (with layer progress) / Ready / Failed

### 3. Model Management

Control what's running on your cluster.

- **Load model** — select model + partitioning strategy (Tensor / Pipeline) + network (RDMA / Ethernet)
- **Unload model** — purge current instance to free memory
- **Switch model from chat** — seamless model switching with progress bar
- **Model list** — scan `~/.exo/models/` on each node, show what's installed where
- **Active model detection** — via exo `/state` API, shown with flash icon
- **Delete model** — remove from one or all nodes, with disk usage display

### 4. Model Download & Distribution

Download models from HuggingFace and distribute across your cluster.

**Why ExoScopy handles this instead of exo:** exo's native behavior downloads the full model on every node independently from HuggingFace. For a 140GB model on 4 nodes, that's 560GB of internet bandwidth. ExoScopy downloads once and distributes via LAN — faster and bandwidth-friendly.

- **HuggingFace search** — search models by name, filter by format/size
- **Download to one node** — pull from HF to user-selected node with progress tracking
- **Pipelined LAN distribution** — as each file completes, rsync it to other nodes in parallel (don't wait for full download)
- **Progress tracking** — real-time progress per node via Socket.IO
- **Resume support** — rsync delta transfer handles interrupted syncs
- **Selective distribution** — choose which nodes receive the model
- **No centralized catalog** — simple scan of model directories, typical user has 3-5 models

### 5. Settings

- **Cluster config** — node list (name, IP, RAM), add/remove nodes
- **exo endpoint** — configurable API endpoint (ip:port)
- **SSH config** — user, key path, options for node management
- **Model paths** — where models are stored on each node

---

## What ExoScopy is NOT

ExoScopy is deliberately scoped. It does **not** include:

- Model format conversion (MLX, GGUF, etc.)
- Multi-engine support (Inferencer, vLLM, Ollama, ...) — exo only
- RAG pipelines, crawlers, or document processing
- Cloud API proxying (OpenRouter, etc.)
- User authentication or multi-tenancy

---

## Tech Stack

### v1 — Web

| Layer | Tech | Why |
|-------|------|-----|
| Backend | Node.js + Express | Simple, fast, good SSH/process handling |
| Realtime | Socket.IO | Live metrics, sync progress |
| Frontend | React (CDN) + Tailwind | Single HTML file, no build step |
| Model sync | rsync via SSH | Battle-tested, incremental |
| Deployment | Docker or bare Node | One-command install |

Single `index.html` with inline JSX + Babel standalone — no webpack, no npm build, no framework overhead. Works on any machine that can run Node.js.

### Future — Mobile

Potential React Native or Swift UI companion app. Core API is already REST + SSE, so a mobile client would just be a different frontend against the same backend. Design decisions to keep in mind:

- API-first: every feature accessible via REST endpoints
- SSE for streaming: standard protocol, works on all platforms
- Stateless auth: no sessions, no cookies (local network assumed)

---

## Architecture

```
Browser                    ExoScopy Server              exo Cluster
┌──────────────┐   HTTP   ┌──────────────┐   HTTP    ┌────────────┐
│  React SPA   │ ◄──────► │  Express     │ ────────► │ exo master │
│  (chat,      │   WS     │  :3456       │  /state   │ :52415     │
│   monitor,   │ ◄──────► │             │  /v1/...  │            │
│   settings)  │          │  Socket.IO   │           │ node 2..N  │
└──────────────┘          │             │   SSH     └────────────┘
                          │  SSE proxy   │ ────────►  rsync
                          └──────────────┘            model sync
```

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/completions` | SSE proxy to exo chat API |
| GET | `/api/chat/models` | List models on disk (SSH scan) |
| GET | `/api/chat/active-model` | Currently loaded model (exo /state) |
| POST | `/api/models/load` | Load model on cluster (exo /place_instance) |
| DELETE | `/api/models/unload/:id` | Unload model (exo DELETE /instance) |
| GET | `/api/cluster/status` | Node status, metrics, runner state |
| GET | `/api/cluster/topology` | RDMA/network topology for Space View |
| POST | `/api/sync/start` | Start rsync distribution to nodes |
| GET | `/api/sync/progress` | Sync progress (Socket.IO events) |
| GET | `/api/conversations` | List conversations |
| GET/PUT | `/api/conversations/:id` | Get/update conversation |
| GET/PUT | `/api/settings` | Read/write settings |

### Data Persistence

```
data/
├── settings.json         — cluster config, params, system prompt
├── conversations/        — one JSON file per conversation
└── downloads.json        — download/distribution queue state
```

---

## UI Layout

```
┌─────────────────────────────────────────────────┐
│  ExoScopy          [Chat] [Monitor] [Settings]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Main content area                              │
│  (Chat / Monitoring / Settings panel)           │
│                                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Chat View
- Left sidebar: conversation list (filterable, searchable)
- Center: message thread with streaming, stats, think blocks
- Top bar: model selector (with active model flash icon), params toggle, export, clear
- Params panel: presets row + temperature / max_tokens / thinking / advanced params

### Monitor View
- Toggle: Grid view / Space View (SVG topology)
- Per-node cards: status, RAM, GPU%, temp, power, IP
- Active model display with runner loading progress
- Reboot node button

### Settings View
- Cluster nodes table (name, IP, RAM, model path)
- exo endpoint configuration
- SSH settings
- System prompt (with ON/OFF toggle)

---

## Install & Run

Target: **one-command setup**.

```bash
git clone https://github.com/user/exoscopy.git
cd exoscopy
npm install
node server/index.js
# → http://localhost:3456
```

Or with Docker:

```bash
docker run -d -p 3456:3456 \
  -v ~/.ssh:/root/.ssh:ro \
  -v ./data:/app/data \
  exoscopy
```

### First Run

1. Open `http://localhost:3456`
2. Go to Settings → add your exo nodes (name, IP)
3. Set exo endpoint (default: `192.168.86.29:52415`)
4. Go to Chat → your models appear automatically
5. Start chatting

---

## Differences from Model Manager

| Feature | Model Manager | ExoScopy |
|---------|--------------|----------|
| Engines | exo + Inferencer | exo only |
| Model download | HuggingFace pipeline | HF download + LAN distribution |
| MLX conversion | Built-in | Not included |
| Mini dashboard | RAG, Crawler, SSD | Not included |
| OpenRouter proxy | Yes | Not included |
| Model sync | Full rsync pipeline | Simplified sync |
| Language | French UI | English UI |
| Chat | Multi-engine tabs | Single clean chat |
| Monitoring | EXO + Inferencer screens | Unified cluster view |
| Target | Internal tool | Public open-source |

---

## Roadmap

### v1.0 — Core
- [ ] Chat with streaming, conversations, stats
- [ ] Cluster monitoring (grid + Space View)
- [ ] Model load/unload from UI
- [ ] Active model detection
- [ ] Parameter presets (Creative / Normal / Code)
- [ ] System prompt with toggle
- [ ] Export conversations (Markdown / JSON)
- [ ] Multi-turn editing
- [ ] File attachments
- [ ] HuggingFace model download (search, download, progress tracking)
- [ ] Model distribution (download once, rsync to other nodes via LAN)
- [ ] Model library (browse installed models per node, disk usage, delete)
- [ ] Docker + bare Node install
- [ ] Settings UI

### v1.1 — Polish
- [ ] Dark/light theme
- [ ] Keyboard shortcuts (Cmd+Enter send, Cmd+K new chat, ...)
- [ ] Search across conversations
- [ ] Thinking mode with reasoning effort control
- [ ] Node reboot from UI
- [ ] Auto-detect exo cluster (mDNS/broadcast)

### v1.2 — Remote Access & Mobile
- [ ] Mobile-responsive web layout (CSS only, no code change)
- [ ] PWA support (Add to Home Screen, service worker)
- [ ] Tailscale / ZeroTier / Cloudflare Tunnel documentation
- [ ] REST API documentation (OpenAPI)

### v2.0 — Native Mobile
- [ ] SwiftUI iOS app (talks to same REST + SSE backend)
- [ ] Push notifications (model loaded, sync complete)

---

## Remote Access

ExoScopy's backend is a standard HTTP server (REST + SSE). Any VPN/tunnel solution gives mobile and remote access with zero code changes:

- **Tailscale** — `http://100.x.x.x:3456` from anywhere, auth built into the mesh
- **Cloudflare Tunnel** — public HTTPS URL, no port forwarding
- **ZeroTier** — similar to Tailscale, self-hostable

The API-first architecture means any client (browser, iOS app, CLI) can talk to the same backend. SSE streaming works on all platforms including mobile Safari.

---

## Reference: exo Tech Stack

exo itself uses: Python (FastAPI) + Rust bindings for backend, **SvelteKit + Tailwind + D3** for dashboard, **Swift/Xcode** for macOS .dmg app. ExoScopy is complementary — a richer client focused on chat and cluster management.

---

## License

MIT — use it, fork it, ship it.
