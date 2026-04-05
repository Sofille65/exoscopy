# ExoScopy — Dashboard Screen

> Vue opérationnelle : activité fichiers + status cluster.

---

## Layout

Deux colonnes : Activity (gauche, flex) + Cluster Nodes (droite, 320px).

```
┌─────────────────────────────────────────────────────────────────────┐
│  Nav bar                                                            │
├─────────────────────────────────────────────────────────────────────┤
│  Dashboard              [⚡ Qwen3.5-397B-9bit · Pipeline · RDMA]   │
├──────────────────────────────────────────┬──────────────────────────┤
│  DOWNLOADING                             │ CLUSTER NODES            │
│  [download card with progress]           │ [● ultra-512   .29]      │
│                                          │ [RAM bar + GPU/temp/W]   │
│  DISTRIBUTING                            │                          │
│  [rsync card with per-node progress]     │ [● ultra-256a  .30]      │
│                                          │ [RAM bar + GPU/temp/W]   │
│  QUEUED                                  │                          │
│  [#1 model name]                         │ [● ultra-256b  .31]      │
│                                          │ [RAM bar + GPU/temp/W]   │
│  HISTORY                                 │                          │
│  [✓ done] [⚠ stopped]                   │ [● ultra-256c  offline]  │
└──────────────────────────────────────────┴──────────────────────────┘
```

## Active Model Strip

En haut à droite, cartouche jaune : modèle actif + Pipeline/Tensor + RDMA + node count.

## Activity (colonne gauche)

### Downloading
- Modèles en cours de download HF
- Progress bar jaune, GB/total, %, vitesse, bouton Stop

### Distributing
- rsync en cours entre nodes
- Badge "RSYNC" indigo
- Progress bar par node cible (indigo)

### Queued
- Position dans la queue + nom + taille estimée
- Bouton Cancel

### History
- ✓ Done, ⚠ Stopped (avec Restart), timestamp
- 🗑 pour supprimer

## Cluster Nodes (colonne droite)

Cards empilées par node :
- Dot status (vert/rouge) + nom + IP
- RAM bar + used/total GB (%)
- GPU% · temp° · watts · model count
- Node offline : opacity réduite, "Offline" en rouge

## Widget flottant

Le cluster widget (artboard séparé) reste disponible en overlay depuis n'importe quel écran via le badge "3/4 online" dans la nav.
