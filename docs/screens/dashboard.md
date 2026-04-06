# ExoScopy — Dashboard Screen (merged Dashboard + Models)

> Control panel: model management, cluster status, activity monitor.
> Replaces the separate Dashboard and Models pages.

---

## Layout

Two columns: left (status bar + matrix + activity) + right (cluster nodes, 280px).

```
┌─────────────────────────────────────────────────────────────────────┐
│  Nav bar                                                            │
├─────────────────────────────────────────────────────────────────────┤
│ ● Running  Qwen3.5-397B  Pipeline·RDMA  [Select▾] [Pipe|Tens] [Un]│
├──────────────────────────────────────────┬──────────────────────────┤
│  MODEL        │ 512    │ 256a   │ 256b  │ CLUSTER                  │
│  ⚡Qwen3.5    │ ✓415GB │ ✓415GB │ ✓415GB│ ● ultra-512       .29    │
│   GLM-5       │ ✓      │ ✓      │ ✓     │ RAM 14.5/512GB           │
│   DeepSeek    │ ✓      │ —      │ —  Syn│ GPU 7% 38°C 36W  725GB  │
│                                         │                          │
│  ACTIVITY                               │ ● ultra-256a       .30   │
│  [download progress bar]                │ RAM 11.5/256GB           │
│  [rsync progress]                       │ GPU 25% 37°C 25W  725GB │
│  [history]                              │                          │
└─────────────────────────────────────────┴──────────────────────────┘
```

## Status Bar (top)

Green bar showing:
- Running/Loading/No model status with dot indicator
- Model name (mono)
- Pipeline · RDMA info
- **Model dropdown** (min-width 280px) — installed models, ⚡ on active
- **Pipeline/Tensor** toggle
- **Unload** button (red, only when running)
- **Load** button (yellow)

## Model Matrix

Table models × nodes:
- Header: node name + disk free per node
- Rows sorted by size descending
- ✓ + size when installed, — when absent
- ⚡ + amber background on active model
- Trash icon (SVG) under each ✓ — click turns red for selection
- **Sync** button on rows where model is missing on some nodes
- **Delete bar** appears when trash icons selected: count + Cancel + Delete

## Activity

Below matrix, shows when active:
- **Downloads** — HF download progress (yellow bar, GB/total, %, speed, Stop)
- **Syncs** — rsync progress per target node (indigo bars, RSYNC badge)
- **Queue** — position #N, Cancel
- **History** — ✓ done / ⚠ stopped, Restart, trash

## Cluster Nodes (right column)

Cards stacked vertically:
- Dot status (green/red) + name + IP
- RAM bar (used/total GB)
- GPU% · temp° · watts
- **SSD free badge** (hard drive icon, aligned right) with color-coded border:
  - Green: <75% used
  - Orange: 75-90% used
  - Red: >90% used
- Offline node: red border, opacity 0.6, "Offline" text
