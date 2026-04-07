# ExoScopy

**See your cluster. Run your models.**

Web dashboard for [exo](https://github.com/exo-explore/exo) — the open-source distributed Apple Silicon inference framework.

![ExoScopy](https://img.shields.io/badge/version-1.2.0-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Chat** — stream responses with presets, file attachments, multi-turn editing, thinking mode, system prompts, stats, code block save
- **Dashboard** — model matrix across nodes, load/unload, sync via rsync, delete, cluster monitoring (RAM, GPU, temp, SSD)
- **Downloads** — search HuggingFace (exo qualified MLX models), smart cross-filters, distributed download (auto-rsync to all nodes)
- **Settings** — node discovery, SSH key setup, config check (8 dependencies per node), endpoint test

## Quick Start

### Option 1: Docker (recommended)

```bash
docker run -d --name exoscopy \
  -p 3456:3456 \
  -v ~/.ssh:/root/.ssh \
  -v exoscopy-data:/app/data \
  ghcr.io/sofille65/exoscopy:latest
```

Open **http://localhost:3456**

### Option 2: Docker Compose

```bash
git clone https://github.com/Sofille65/exoscopy.git
cd exoscopy
docker compose up -d
```

### Option 3: Node.js

```bash
git clone https://github.com/Sofille65/exoscopy.git
cd exoscopy
npm install
node server/index.js
```

## First Run

1. Go to **Settings** → add your exo nodes (or click **Re-discover**)
2. Set the **EXO Endpoint** to your master node IP
3. Click **Check Config** to verify SSH, Python, rsync, etc.
4. Click **Setup SSH Keys** for model sync between nodes
5. Go to **Chat** → your installed models appear automatically
6. Start chatting

## Requirements

- [exo](https://github.com/exo-explore/exo) running on your Apple Silicon Mac(s)
- Docker (for Option 1 & 2) or Node.js 20+ (for Option 3)
- Nodes reachable on port 52415 (exo default) and SSH (port 22)
- Python 3 + `huggingface_hub` on the primary node (for HF downloads)

## Architecture

```
Browser → ExoScopy (:3456) → exo cluster (:52415)
              ↕ SSH
         Node management (sync, delete, metrics)
```

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: React 18 (Babel in-browser) + Tailwind CDN
- **No build step** — single `index.html`
- **Persistence**: JSON files in Docker volume (`data/`)
- **User prefs**: localStorage (system prompts)

## License

MIT
