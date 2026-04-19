# ExoScopy

**See your cluster. Run your models.**

Web dashboard for [exo](https://github.com/exo-explore/exo) — the open-source distributed Apple Silicon inference framework.

![ExoScopy](https://img.shields.io/badge/version-1.12.1-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Chat** — stream responses with presets, file attachments, multi-turn editing, thinking mode, system prompts, stats, code block save
- **Multimodal inference** — attach **images** or **PDFs** and use vision-capable models (Gemma 4, Qwen3-VL, Kimi K2.5). PDF text + page rasterization happens client-side, fully offline. Requires exo v1.0.70+.
- **Dashboard** — model matrix across nodes, load/unload, sync via rsync, delete, cluster monitoring (RAM, GPU, temp, SSD)
- **Downloads** — search HuggingFace (exo qualified MLX models), smart cross-filters, distributed download (auto-rsync to all nodes)
- **Settings** — node discovery, SSH key setup, config check (8 dependencies per node), endpoint test
- **Multi-user** — administrator mode with login, per-user conversations, role-based access (admin/user/guest)
- **Guest mode** — token-limited guest access for visitors, no login required
- **Self-contained** — all UI dependencies (React, Tailwind, PDF parser) bundled in the Docker image. **No CDN calls at runtime**, works on air-gapped networks.

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

### Option 1: Docker (recommended)

```bash
docker run -d --name exoscopy \
  -p 3456:3456 \
  -v ~/.ssh:/root/.ssh \
  -v exoscopy-data:/app/data \
  --restart unless-stopped \
  ghcr.io/sofille65/exoscopy:latest
```

Open **http://localhost:3456**

> **`~/.ssh` mount** — gives ExoScopy access to your SSH keys for node management (sync, metrics, delete).
> **`exoscopy-data` volume** — persists settings, conversations, users, and download history across container restarts and updates.

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

## Multi-User & Administrator Mode

ExoScopy supports optional multi-user access for shared LAN deployments.

### Enabling Admin Mode

1. Go to **Settings** → **Administrator Mode**
2. Set an admin password → **Enable**
3. You're automatically logged in as admin

### Roles

| | Admin | User | Guest |
|---|---|---|---|
| Chat | Own conversations | Own conversations | Shared (token-limited) |
| Dashboard | Full access | Read-only | No access |
| Downloads | Full access | No access | No access |
| Settings | Full access + user management | No access | No access |

### Guest Mode

When enabled (Settings → Guest Access), visitors can chat without logging in:
- Token limit per session (default: 50,000 tokens)
- Chat-only access
- "Try as Guest" button on login screen
- Toggle off to cut all guest access instantly

### Connection Log

Settings shows a live connection log with timestamp, username, action, and IP for every login, logout, guest session, and failed attempt.

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

Your settings, conversations, users, and downloads are preserved in the `exoscopy-data` volume.

> **Note**: After updating, SSH keys inside the container are regenerated. Re-run **Setup SSH Keys** in Settings to restore node connectivity.

> **WARNING**: Never run `docker volume rm exoscopy-data` — this permanently deletes all your data. The volume is safe through `docker stop`, `docker rm`, and `docker pull` — only `docker volume rm` destroys it.

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
| Frontend | React 18 + Tailwind + Babel (all self-hosted in `public/vendor/`) |
| PDF | pdf.js 3.11.174 (client-side text extraction + rasterization) |
| Auth | bcryptjs + cookie-session (signed cookies, no server-side store) |
| Build | None — single `index.html`, no webpack/vite |
| Persistence | JSON files in `data/` (Docker volume) |
| Node comms | HTTP (exo API) + SSH (rsync, metrics, delete) |
| Docker | `node:20-alpine` + openssh + sshpass + rsync |

All frontend libraries are **bundled in the Docker image** under `public/vendor/` (~5 MB total). ExoScopy makes zero external network calls at runtime — safe for air-gapped or locked-down networks.

### Data Storage

```
data/
  settings.json           — cluster config, admin/guest mode toggles
  users.json              — user accounts (username, passwordHash, role)
  auth-log.json           — connection log (last 500 events)
  session-secret.txt      — cookie signing key (auto-generated)
  conversations.json      — shared conversations (admin mode OFF)
  downloads.json          — download queue and history
  users/
    admin/
      conversations.json  — admin's conversations (admin mode ON)
    alice/
      conversations.json  — per-user conversations
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Nodes show "0/N online" | Check that exo is running on your nodes and port 52415 is reachable |
| SSH keys fail | Make sure Remote Login is enabled on each Mac (System Settings → Sharing) |
| Download fails | Run **Check Config** in Settings — verify Python 3 and huggingface_hub on primary node |
| Models don't appear after sync | exo takes time to re-scan models — wait ~30s or restart exo |
| TTFT very slow (30-50s) | Qwen3.5 thinking mode — make sure Thinking is OFF in Inference Settings |
| White screen | Check browser console for errors — try hard refresh (Cmd+Shift+R) |
| 401 after update | Admin mode is ON — log in, or disable admin mode via Settings |
| SSH keys lost after update | Normal — re-run **Setup SSH Keys** in Settings after every container update |
| "Current model doesn't support vision" warning | Select a vision-capable model (👁 in dropdown) — Gemma 4, Qwen3-VL, Kimi K2.5 — or remove the image/PDF attachment |
| PDF stuck on "Processing…" | Browser is extracting text and rasterizing pages. Expect ~500ms per page. Encrypted PDFs are not supported. |
| Vision models not appearing | Update exo to v1.0.70+ on your cluster; models need `capabilities: ["vision"]` in their manifest |

---

## License

MIT
