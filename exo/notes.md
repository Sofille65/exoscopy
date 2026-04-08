# EXO Cluster - Notes de projet

## Setup actuel
- 4 x Mac Studio M2 Ultra : 192.168.86.29 / .30 / .31 / .32
- User: admin@ (SSH keys configurees entre ce Mac et les 4)
- **En production : EXO.app v1.0.68** (le .dmg, pas le build from source)
- Repo git ~/exo sur chaque machine (v1.0.68 checkout) - garde pour reference/debug
- Symlink models : ~/.cache/huggingface -> /Volumes/models/exo
- Dashboard : http://192.168.86.29:52415

## Probleme identifie : mDNS peer discovery (build from source)

### Symptome
`uv run exo` : chaque node s'elit Master seul, zero peer discovery.
Le .dmg fonctionne parfaitement (cluster 4 nodes).

### Root cause (FINALE)
`if_watch` (crate Rust utilisee par `libp2p-mdns v0.48.0`) ne produit **aucun**
`IfEvent::Up` quand executee dans le tokio runtime de `pyo3-async-runtimes` sur
macOS 26.3 (Tahoe) avec 42 interfaces reseau (Thunderbolt bridges).

Sans evenements `IfEvent::Up`, aucun `InterfaceState` n'est cree, donc aucun
socket mDNS n'est cree, donc aucune decouverte n'a lieu.

Facteurs aggravants :
- 42 interfaces reseau (6 Thunderbolt, 6 anpi, etc.)
- `mDNSResponder` (daemon systeme) ecoute aussi sur UDP 5353
- `SO_REUSEPORT` distribue les paquets aleatoirement entre sockets

### Patches tentes (aucun ne resout)
1. Filtrage link-local 169.254.x.x dans libp2p-mdns → if_watch ne fire toujours pas
2. Env var EXO_BIND_IP pour forcer l'interface → if_watch ne fire toujours pas
3. Les patches sont dans ce dossier pour reference

### Decision
On reste sur le .dmg. Issue GitHub a poster pour le fix upstream.

### Fichiers dans ce dossier
- `exo-mdns-issue.md` - Issue complete prete a poster sur GitHub
- `exo-issue-update.md` - Premiere analyse
- `discovery-patched.rs` - discovery.rs avec logs mDNS ajoutes
- `libp2p-mdns-behaviour-patched.rs` - Patch link-local + EXO_BIND_IP filter
- `notes.md` - Ce fichier

### Pour poster l'issue
```
gh auth login
gh issue create --repo exo-explore/exo --title "Build from source: mDNS peer discovery fails on Mac Studio (macOS Tahoe 26.3)" --body-file exo-mdns-issue.md
```
