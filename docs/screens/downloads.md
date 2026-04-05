# ExoScopy — Downloads Screen (HuggingFace)

> Recherche et téléchargement de modèles depuis HuggingFace.
> L'activité en cours (progress, queue, history) est sur le Dashboard.

---

## Layout

Page en sections empilées verticalement.

## Sections

### Downloading
- Modèles en cours de téléchargement depuis HuggingFace
- Progress bar jaune (#ffde00) avec GB/total, %, vitesse MB/s, fichiers restants
- Bouton Stop
- État "DISTRIBUTING" (indigo) quand rsync en cours vers les autres nodes
  - Progress bar par node cible

### Queued
- Modèles en attente (queue max 3 slots)
- Position dans la queue (#1, #2...)
- Bouton Cancel

### History
- ✓ Done : modèle downloadé + distribué, avec timestamp
- ⚠ Stopped : avec taille partielle, bouton Restart
- ✕ Error : avec message, bouton Restart
- 🗑 pour supprimer de la liste

## Badge slots
- "2/3 slots" dans le header, jaune quand actif
