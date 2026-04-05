# ExoScopy — Settings Screen

> Configuration du cluster, endpoint exo, SSH.

---

## Layout

Deux colonnes : settings principaux (gauche) + About (droite).

## Sections

### EXO Nodes
- Table : Name, IP, RAM, Status (Online/Offline), Edit
- Bouton "+ Add node" (jaune)
- Bouton "Re-discover" (scan LAN port 52415)
- Node offline = ligne muted

### EXO Endpoint
- IP + Port configurables
- Bouton Test → affiche "Connected" (vert) ou "Failed" (rouge)

### SSH
- User (default: admin)
- Key path (default: /root/.ssh/id_ed25519)
- Bouton "Test SSH on all nodes"

### About (colonne droite)
- Version
- Nodes configurés, models installés
- Liens : ExoScopy GitHub, exo GitHub, exo Dashboard

## Setup Wizard (first run)
Quand setupComplete = false :
1. Welcome → "Set up my cluster"
2. Node Discovery → scan LAN, résultats, ajout manuel
3. SSH Setup → guide Remote Login macOS, test connectivité
4. Done → redirect vers Dashboard
