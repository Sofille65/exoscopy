# ExoScopy — Chat Screen

> Page d'accueil de l'application. C'est l'écran principal.

---

## Layout général

```
┌─────────────────────────────────────────────────────────────────────┐
│  Nav bar (persistent)                                               │
│  [ExoScopy]  [Chat] [Dashboard] [Models] [Downloads] [Settings]  ⚡│
├────────┬────────────────────────────────────────────────┬───────────┤
│Sidebar │  Chat area                                     │ Params    │
│        │                                                │ panel     │
│ Search │  [messages thread]                             │(collapse) │
│        │                                                │           │
│ conv 1 │                                                │ Presets   │
│ conv 2 │                                                │ Temp      │
│ conv 3 │                                                │ MaxTok    │
│ conv 4 │                                                │ Thinking  │
│        │                                                │ top_p     │
│        │                                                │ top_k     │
│        │                                                │ ...       │
│        │                                                │           │
│        ├────────────────────────────────────────────────┤           │
│        │  [Model ▾]          [📎] [input area] [Send]  │           │
│[+New]  │                                                │           │
└────────┴────────────────────────────────────────────────┴───────────┘
```

Trois colonnes, inspiré Inferencer Pro :
- **Sidebar gauche** (~220px) : conversations
- **Centre** (flex) : thread de messages + input
- **Panneau droit** (~280px, collapsible) : paramètres d'inférence

---

## Nav bar (top, persistent sur toutes les pages)

| Zone | Contenu |
|------|---------|
| Gauche | Logo ExoScopy + version muted |
| Centre | Tabs : **Chat** (actif), Dashboard, Models, Downloads, Settings |
| Droite | Cluster badge `3/4 online` + modèle actif `⚡ Qwen3.5-397B-9bit` |

Le modèle actif dans la nav sert de feedback global — on sait toujours ce qui tourne.

---

## Sidebar gauche

### Header sidebar
- Champ recherche conversations (icone loupe, placeholder "Search...")
- Bouton `+ New` (nouvelle conversation)

### Liste conversations
- Pinned en premier (icone pin subtle), puis par date
- Chaque item :
  - Titre (auto-généré depuis premier message, 60 char max)
  - Preview dernier message (1 ligne, muted)
  - Timestamp relatif (2h, yesterday, Mar 28)
  - Stats inline muted : `23 tk/s` du dernier échange
- Hover : actions apparaissent (rename, pin/unpin, export, delete)
- Conversation active : fond légèrement plus sombre / accent left border

### Footer sidebar
- Bouton export visible quand conversation sélectionnée : `↓ MD` / `↓ JSON`

---

## Zone centrale — Header

Barre au-dessus du thread :

```
[Qwen3.5-397B-A17B-9bit ▾]  ⚡    [Creative | Normal | Code]    [⚙ Params]
```

- **Model selector** : dropdown des modèles sur disque. Le modèle actif (chargé via exo) est marqué ⚡ et pré-sélectionné. Si l'utilisateur choisit un autre modèle → model switch SSE automatique (purge + load + progress bar)
- **Presets** : 3 boutons toggle group, un seul actif. Applique un set de params prédéfini
  - Creative : temp 1.2, top_p 0.95
  - Normal : temp 0.7 (default)
  - Code : temp 0.2, top_p 0.9, top_k 50, min_p 0.05
- **⚙ Params** : toggle le panneau droit (ouvert/fermé)

---

## Zone centrale — Messages

### Message utilisateur
- Aligné à droite ou fond distinct (light blue/gray très léger)
- Texte brut (pas de markdown)
- Si pièce jointe : badge fichier `📎 filename.py (2.4 KB)` au-dessus du texte
- Hover : bouton ✏ edit (multi-turn editing)

### Message assistant
- Aligné à gauche, fond blanc
- Markdown rendu complet (marked.js) : headers, listes, code blocks, tableaux
- **Code blocks** : syntax highlight, bouton copier, bouton 💾 save
  - Si multiple code blocks : bouton `📦 Save all (.zip)` en fin de message
- **Thinking blocks** (`<think>...</think>`) : zone collapsible, fond muted, texte italic, fermé par défaut. Label : "Thinking... (click to expand)"
- **Streaming** : curseur animé pendant la génération (bloc qui pulse, pas un spinner)

### Stats par message (sous chaque réponse assistant, muted, petite taille)
```
TTFT 1.8s · 23.2 tk/s · 847 tokens · 36.5s
```

### Multi-turn edit
- Click ✏ sur un message user → textarea pré-remplie
- Warning : "N messages below will be removed"
- Confirm → tronque, régénère depuis ce point

### Inference en background
- Si l'utilisateur quitte et revient pendant un streaming, le message continue à s'accumuler côté serveur
- À la réouverture : le message complet apparaît (polling 500ms si inference active)

---

## Zone centrale — Input bar

```
┌──────────────────────────────────────────────────────────────┐
│ [Model ▾]                                                     │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [📎]  Type your message...                        [Send] │ │
│ └──────────────────────────────────────────────────────────┘ │
│ 📎 file1.py (2KB) ✕  📎 file2.md (800B) ✕  [✕ Remove all]  │
└──────────────────────────────────────────────────────────────┘
```

- **Textarea** : auto-resize, min 1 ligne, max ~6 lignes avant scroll
- **📎** : multi-file input (`.txt, .md, .json, .py, .js, .ts, .jsx, .tsx, .csv, .yaml, .yml, .toml, .sh, .html, .css, .xml, .log`)
- **File badges** : sous l'input quand fichiers attachés, ✕ individuel + "Remove all" si > 1
- **Send** : actif si texte OU fichier attaché. Keyboard : Enter pour envoyer (Shift+Enter pour nouvelle ligne)
- **Pendant le streaming** : Send devient `■ Stop`

---

## Panneau droit — Params

Collapsible (toggle via ⚙ dans le header). Scroll indépendant.

### Section : Generation

| Param | Control | Default | Notes |
|-------|---------|---------|-------|
| Temperature | Slider 0–2 | 0.7 | Valeur affichée à côté |
| Max tokens | Input numérique | 32768 | Max 131072 |
| Thinking | Toggle ON/OFF | OFF | |
| Reasoning effort | Select | medium | Visible seulement si thinking ON |

### Section : Sampling (exo)

| Param | Control | Default | Notes |
|-------|---------|---------|-------|
| Top P | Slider 0–1 | — | Nucleus sampling |
| Top K | Input | — | Vide = désactivé |
| Min P | Slider 0–0.5 | — | exo-specific |
| Repetition penalty | Slider 1–2 | — | Toujours avec rep_context_size |
| Seed | Input | — | Vide = random |

### Section : System Prompt

- Textarea
- Toggle ON/OFF (prompt reste en mémoire quand OFF)
- "Applied to all messages in this conversation"

Chaque param a un `(?)` tooltip avec description courte.

---

## États spéciaux

### Empty state (aucune conversation)
```
     ExoScopy

     Select a model to get started.

     [Model ▾]  [Start chatting →]
```

### No model loaded
- Banner en haut du chat : "No model loaded on cluster. Load one from Dashboard or select a model below."
- Model selector avec bouton Load intégré

### Model switching
- Progress bar inline dans le chat : "Loading Qwen3.5-397B... Layer 12/48"
- Disable input pendant le switch

### Offline cluster
- Banner : "Cluster unreachable. Check that exo is running on your nodes."
