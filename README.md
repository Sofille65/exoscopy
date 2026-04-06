# ExoScopy

**See your cluster. Run your models.**

Web dashboard for [exo](https://github.com/exo-explore/exo) — the open-source distributed Apple Silicon inference framework.

![ExoScopy](https://img.shields.io/badge/version-1.0.0-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Chat** — stream responses from your exo cluster with full parameter control (temperature, top_p, thinking mode, presets)
- **Dashboard** — model matrix across nodes, load/unload models, sync via rsync, cluster monitoring (RAM, GPU, temp, SSD)
- **Downloads** — search and download MLX models from HuggingFace with smart filters
- **Settings** — node discovery, SSH key setup, endpoint configuration

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
3. Go to **Chat** → your models appear automatically
4. Start chatting

## Requirements

- [exo](https://github.com/exo-explore/exo) running on your Apple Silicon Mac(s)
- Docker (for Option 1 & 2) or Node.js 20+ (for Option 3)
- Nodes reachable on port 52415 (exo default)

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

## License

MIT
