# Getting Started

## What is ExoScopy?

ExoScopy is a web dashboard for [exo](https://github.com/exo-explore/exo) — the open-source framework that turns Apple Silicon Macs into a distributed AI inference cluster. It gives you a clean interface to chat with your models, monitor your cluster, manage models across nodes, and download new ones from HuggingFace.

## Install

### One-line Docker command

```bash
docker run -d --name exoscopy \
  -p 3456:3456 \
  -v ~/.ssh:/root/.ssh \
  -v exoscopy-data:/app/data \
  --restart unless-stopped \
  ghcr.io/sofille65/exoscopy:latest
```

Then open **http://localhost:3456** in your browser.

The container is **fully self-contained** — all UI dependencies (React, Tailwind, PDF parser, etc.) are bundled in the image. No external CDN calls at runtime, works on air-gapped networks.

### Docker Compose (alternative)

```yaml
services:
  exoscopy:
    image: ghcr.io/sofille65/exoscopy:latest
    container_name: exoscopy
    ports:
      - "3456:3456"
    volumes:
      - ~/.ssh:/root/.ssh
      - exoscopy-data:/app/data
    restart: unless-stopped

volumes:
  exoscopy-data:
```

Save as `docker-compose.yml` and run `docker compose up -d`.

### Update

```bash
docker pull ghcr.io/sofille65/exoscopy:latest
docker stop exoscopy && docker rm exoscopy
# then re-run the docker run command above
```

Your settings, conversations, and users persist in the `exoscopy-data` volume.

## Requirements

- One or more Mac with [exo](https://github.com/exo-explore/exo) running (any version; v1.0.70+ recommended for image/PDF inference)
- Nodes on the same local network as the ExoScopy host
- SSH access to nodes enabled (macOS: System Settings → General → Sharing → Remote Login) — needed for model distribution and disk monitoring
- Any host that runs Docker: Mac, Linux, Raspberry Pi 5, NAS, etc.

## First Setup

1. Go to **Settings** and add your EXO nodes (name + IP address)
2. Or click **Re-discover** to automatically find exo nodes on your network
3. Set the **EXO Endpoint** (IP of your master node, port 52415)
4. Click **Test** to verify connectivity
5. For model sync between nodes: enter passwords and click **Setup SSH Keys**
6. Head to the **Chat** tab — ExoScopy auto-loads the first available model when you send your first message

## Enabling multi-user (optional)

By default ExoScopy is single-user (no login). To enable multi-user access with admin / user / guest roles:

- **Settings → Administrator Mode** → set an admin password → Enable
- You'll be asked to log in afterwards
- See the **Settings** help page for full details
