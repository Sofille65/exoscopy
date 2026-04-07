# ExoScopy

**See your cluster. Run your models.**

Web dashboard for [exo](https://github.com/exo-explore/exo) — the open-source distributed Apple Silicon inference framework.

![ExoScopy](https://img.shields.io/badge/version-1.2.0-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Chat** — stream responses with presets, file attachments, multi-turn editing, thinking mode, system prompts, stats, code block save
- **Dashboard** — model matrix across nodes, load/unload, sync via rsync, delete, cluster monitoring (RAM, GPU, temp, SSD)
- **Downloads** — search HuggingFace (exo qualified MLX models), smart cross-filters, distributed download (auto-rsync to all nodes)
- **Settings** — node discovery, SSH key setup, config check (8 dependencies per node), endpoint test

---

## Prerequisites

### On your exo cluster nodes (Mac Studios, Mac Minis, etc.)

1. **exo** installed and running — [github.com/exo-explore/exo](https://github.com/exo-explore/exo)
2. **SSH enabled** — macOS: System Settings → General → Sharing → Remote Login → ON
3. **Python 3** installed (comes with macOS)
4. **huggingface_hub** on the primary node (for HF downloads):
   ```bash
   pip3 install huggingface_hub
   ```
5. **rsync** installed (comes with macOS)

### On the machine running ExoScopy

- **Docker** (recommended) or **Node.js 20+**
- Network access to your cluster nodes on:
  - Port **52415** (exo API)
  - Port **22** (SSH — for sync, delete, metrics)

---

## Install

### Option 1: Docker one-liner (recommended)

```bash
docker run -d --name exoscopy \
  -p 3456:3456 \
  -v ~/.ssh:/root/.ssh \
  -v exoscopy-data:/app/data \
  --restart unless-stopped \
  ghcr.io/sofille65/exoscopy:latest
```

Open **http://localhost:3456**

> The `~/.ssh` mount gives ExoScopy access to your SSH keys for node management.
> The `exoscopy-data` volume persists settings, conversations, and downloads across restarts.

### Option 2: Docker Compose

```bash
git clone https://github.com/Sofille65/exoscopy.git
cd exoscopy
docker compose up -d
```

The `docker-compose.yml` pulls from GHCR automatically. To build locally instead:

```bash
docker compose up -d --build
```

### Option 3: Node.js (no Docker)

```bash
git clone https://github.com/Sofille65/exoscopy.git
cd exoscopy
npm install
node server/index.js
```

> Note: `sshpass` and `rsync` must be installed on the host for SSH key setup and model sync.
> macOS: `brew install hudochenkov/sshpass/sshpass`
> Linux: `apt install sshpass rsync`

ExoScopy runs on **http://localhost:3456**

---

## First Run

1. Open **http://localhost:3456** (or your server IP)
2. Go to **Settings**
3. Click **Re-discover** to scan your LAN for exo nodes, or add nodes manually (name + IP)
4. Set the **EXO Endpoint** to your master node IP (port 52415)
5. Click **Test** to verify the exo API is reachable
6. Enter the SSH password for each node → click **Setup SSH Keys** (one-time — installs keys for sync)
7. Click **Check Config** to verify all dependencies per node (green = OK)
8. Go to **Chat** → your installed models appear in the dropdown
9. Start chatting!

---

## Update

### Docker

```bash
docker pull ghcr.io/sofille65/exoscopy:latest
docker stop exoscopy && docker rm exoscopy
docker run -d --name exoscopy \
  -p 3456:3456 \
  -v ~/.ssh:/root/.ssh \
  -v exoscopy-data:/app/data \
  --restart unless-stopped \
  ghcr.io/sofille65/exoscopy:latest
```

Your settings, conversations, and downloads are preserved in the `exoscopy-data` volume.

### Docker Compose

```bash
cd exoscopy
git pull
docker compose up -d --pull always
```

### Node.js

```bash
cd exoscopy
git pull
npm install
# restart the server
```

---

## Architecture

```
Browser → ExoScopy (:3456) → exo cluster (:52415)
              ↕ SSH
         Node management (sync, delete, metrics)
```

| Component | Tech |
|-----------|------|
| Backend | Node.js 20 + Express + Socket.IO |
| Frontend | React 18 (Babel in-browser) + Tailwind CDN |
| Build | None — single `index.html`, no webpack/vite |
| Persistence | JSON files in `data/` (Docker volume) |
| User prefs | Browser localStorage (system prompts) |
| Node comms | HTTP (exo API) + SSH (rsync, metrics, delete) |
| Docker | `node:20-alpine` + openssh + sshpass + rsync |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Nodes show "0/N online" | Check that exo is running on your nodes and port 52415 is reachable |
| SSH keys fail | Make sure Remote Login is enabled on each Mac (System Settings → Sharing) |
| Download fails | Run **Check Config** in Settings — verify Python 3 and huggingface_hub on primary node |
| Models don't appear after sync | exo takes time to re-scan models — wait ~30s or restart exo |
| TTFT very slow (30-50s) | Qwen3.5 thinking mode — make sure Thinking is OFF in Inference Settings |
| White screen | Check browser console for errors — usually a JS issue, try hard refresh (Cmd+Shift+R) |

---

## License

MIT
