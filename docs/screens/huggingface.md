# ExoScopy — HuggingFace Search Screen

> Recherche et téléchargement de modèles depuis HuggingFace.
> Accessible depuis Models → "+ Download" ou via la nav (sous-page de Models).

---

## Layout

Page complète avec search, filtres, résultats.

## Search

- **Champ principal** : recherche texte libre (ex: "qwen3.5")
- **Champ Direct** : entrée directe d'un repo HF (ex: `inferencerlabs/gemma-4-31B-MLX-9bit`)

## Filtres

### Author (toggle pills, multi-select)
- mlx-community, Qwen, Kimi, mistralai, meta-llama, google, inferencerlabs
- "All" pour reset
- Boutons jaunes quand actifs

### Format
- MLX (défaut pour exo) / All

### Quantization
- Q4, Q6, Q8, Q8+, BF16, All
- Multi-select possible

### Size (GB)
- Min / Max inputs
- Max pré-rempli avec la RAM totale du cluster (suggestion intelligente)
- Badge "max cluster RAM" à côté

### Sort by (dropdown)
- Popularity (défaut), Date, Size, Parameters

## Résultats

Chaque résultat affiche :
- Nom du modèle (bold)
- Badges : format (MLX indigo), quant (gris), params (gris)
- Author, taille estimée, download count, date de mise à jour
- Warnings contextuels :
  - ✓ installed (vert) + "already on N nodes" si déjà présent
  - ⚠ may not work with exo (jaune) si format/quant suspect
  - Exceeds cluster RAM (rouge) si trop gros → bouton disabled

## Download action

- **Bouton Download** (jaune) + **▾** pour expand les options
- **Expanded** : panneau "Download to:" avec checkboxes par node
  - ultra-512 coché par défaut (source)
  - Autres nodes optionnels
  - "All nodes" pour tout cocher
  - Label : "Download + rsync to selected"
- Click Download → envoyé dans la queue Downloads
