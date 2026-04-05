# ExoScopy — Project Brief

## What it is
Web-based cluster dashboard for [exo](https://github.com/exo-explore/exo) — the open-source distributed Apple Silicon inference framework. ExoScopy is a public distribution fork of Model Manager, stripped to EXO-only features, with auto-discovery and zero-config setup.

**Tagline**: *See your cluster. Run your models.*

## Philosophy
**Think simple, act simple.** Every feature must justify its complexity. Easy onboarding, minimal config.

## How it differs from Model Manager
- **EXO only** — no Inferencer, no MLX Convert, no ComfyUI
- **Public-ready** — no hardcoded IPs, setup wizard on first run, LAN node discovery
- **Clean defaults** — empty node list, user populates via discovery or manual config
- **Docker one-liner** — `docker run -p 3456:3456 exoscopy/exoscopy`
- **Simplified model management** — no centralized catalog, download-once-distribute-via-LAN

## Tech Stack
- **Backend**: Node.js 20, Express, Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS, React 18 (Babel in-browser), Tailwind CDN
- **No build step** — single `public/index.html`
- **Deployment**: Docker (`node:20-alpine`), port 3456
- **Persistence**: `data/` Docker volume (settings.json, conversations.json, downloads.json)

## Key Files
- `server/index.js` — All API routes, Socket.IO, chat proxy, download queue
- `server/settings.js` — Config (clean defaults, no hardcoded IPs)
- `server/conversations.js` — Chat history CRUD + inference tracking
- `server/scanner.js` — Scan EXO nodes (SSH/rsync), list models on disk
- `public/index.html` — Full SPA (React/JSX inline)
- `docs/PRODUCT.md` — Complete product description (UX/UI reference)

## EXO API
- **Chat**: `POST http://<node>:52415/v1/chat/completions` (OpenAI-compatible + exo extensions)
- **State**: `GET http://<node>:52415/state` → active model, node metrics, topology
- **Load**: `POST http://<node>:52415/place_instance` → `{ model_id, sharding, instance_meta, min_nodes }`
- **Unload**: `DELETE http://<node>:52415/instance/{id}`
- **Models**: `GET http://<node>:52415/v1/models`

### EXO Extra Params (v1.0.69+)
`temperature`, `top_p`, `top_k`, `min_p`, `max_tokens`, `seed`, `enable_thinking`, `reasoning_effort` (none/minimal/low/medium/high/xhigh), `repetition_penalty`, `repetition_context_size`

## Node Discovery
`GET /api/discover` — derives the local /24 subnet, scans all 254 hosts on port 52415 in parallel (2s timeout). Returns `[{ ip, port, reachable, modelCount }]`.

## Model Download & Distribution

### How exo handles models (native behavior)
- Each node downloads the **full model** independently from HuggingFace (no inter-node transfer)
- Even sharded models: every node downloads all files (`allow_patterns = ["*"]`)
- N nodes = N full downloads from HF → wasteful bandwidth, slow on large models
- Default cache: `~/.exo/models/` (macOS)
- Env vars: `EXO_DEFAULT_MODELS_DIR`, `EXO_MODELS_DIRS`, `EXO_MODELS_READ_ONLY_DIRS`

### ExoScopy strategy: download once, distribute via LAN
1. User triggers "Download model X" in ExoScopy
2. ExoScopy downloads from HF on one node (user-selected or primary)
3. As each file completes → rsync to other nodes in parallel (pipeline, don't wait for full download)
4. Files land in `~/.exo/models/{model_id}/` on each node
5. Model ready to load via exo once all nodes have all files

### Download Queue
- `MAX_CONCURRENT_DOWNLOADS = 3`
- `downloadQueue[]` → auto-start via `processQueue()` after each completion
- States: `queued` → `downloading` → `distributing` → `done` / `stopped` / `error`
- Persisted in `data/downloads.json`

### No centralized catalog
- No max-64 pattern, no central model registry
- Simple scan of `~/.exo/models/` on each node to list available models
- Typical user has 3-5 models, not dozens

## Space View
SVG diamond topology (500×520px) — the signature feature:
- 4 nodes in diamond (top / left / right / bottom)
- RDMA connection lines (indigo = active, gray = available, dashed = inactive)
- Node circles with glow (feGaussianBlur stdDeviation=9 on filled circle, opacity 0.45)
- Metrics: name, RAM%, IP, GPU%, temp°C, watts
- Legend: vertical stack, bottom-left

## Version
Current version in `server/settings.js` → `DEFAULTS.version`
UI fetches version from `/api/settings`.

## Development Status
- Version courante : **v1.0.0**
- UX/UI : en cours avec Paper (see docs/PRODUCT.md for complete spec)
- Backend : adapté depuis Model Manager v3.8.014

## v1 Scope

### Core Features
- **Dashboard** — cluster overview (Space View, node metrics), inherited from Model Manager
- **Chat** — EXO inference chat, base from Model Manager + enhancements (TBD)
- **Node Discovery** — LAN auto-discovery on port 52415
- **HF Download** — search & download models from HuggingFace, with progress tracking
- **Model Distribution** — download once on one node, rsync to others via LAN (pipelined file-by-file)
- **Model Management** — scan nodes for installed models, delete, check disk usage

### SSH as Foundation
SSH is the transport layer for file transfers and node management. Requires a polished onboarding:
- "Add Node" wizard guides SSH key exchange
- Key generation from ExoScopy, copy via `ssh-copy-id` or manual paste
- macOS: user enables Remote Login in System Settings → done
- One-time setup, unlocks all features (rsync, stats, file management)

### Out of Scope (never)
- Inferencer / ComfyUI
- MLX Convert
- Centralized catalog (max-64 pattern)

## Roadmap (post v1)
- Multi-cluster
- SwiftUI native app
- Metrics history / graphs
- Mobile layout
