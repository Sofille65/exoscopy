# ExoScopy — Models Screen

> Gestion des modèles installés par node. Sync, download, delete.

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Nav bar                                                            │
├─────────────────────────────────────────────────────────────────────┤
│  Models   6 models across 4 nodes    [🔍 Search HF...] [+ Download]│
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ MODEL            │ ultra-512 │ ultra-256a │ ultra-256b │ 256c │ │
│  │                  │ 3.6TB free│ 3.6TB free │ 3.4TB free │offln │ │
│  ├──────────────────┼───────────┼────────────┼────────────┼──────┤ │
│  │⚡Qwen3.5-397B    │ ✓ 415GB   │ ✓ 415GB    │ ✓ 415GB    │ —    │ │
│  │ GLM-5-8bit      │ ✓ 715GB   │ ✓ 715GB    │ ✓ 715GB    │ —    │ │
│  │ DeepSeek-V3.2   │ ✓ 704GB   │ ✓ 704GB    │ ✓ 704GB    │✓704GB│ │
│  │ Kimi-K2.5       │ ✓ 612GB   │ —          │ —          │ —    │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Model Matrix

Table models × nodes :
- Colonnes : une par node configuré, header avec nom + disk free
- Lignes : un modèle par ligne, trié par taille décroissante
- ✓ + taille = installé, — = absent
- ⚡ = modèle actuellement chargé (fond jaune léger)
- Node offline = colonne muted

## Actions

- **Sync** : visible sur les lignes où le modèle n'est pas sur tous les nodes. rsync depuis un node source vers les nodes manquants
- **···** : menu contextuel (delete, infos)
- **+ Download** : ouvre recherche HuggingFace pour télécharger un nouveau modèle
- **Search HuggingFace** : recherche inline avec résultats

## HF Search (inline ou overlay)

- Input texte + filtre format (MLX/GGUF/All) + sort
- Résultats : nom, author, format, quant, taille estimée, downloads count
- Bouton Download → choisir node cible → lance le download (apparaît dans Downloads)
