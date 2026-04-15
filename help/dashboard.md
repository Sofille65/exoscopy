# Dashboard

The Dashboard tab gives you a real-time overview of your exo cluster.

> **Admin mode only** — This tab is visible to admins and organizers only.

## Space View

The signature visual — a diamond topology showing your cluster nodes with live metrics:

- **Node circles** with glow effect — shows each node's status
- **Connection lines** — indigo = active RDMA, gray = available, dashed = inactive
- **Metrics per node** — name, RAM%, IP, GPU%, temperature, watts

## Model Matrix

A grid of models × nodes:

- **✓** = model installed on that node
- **—** = model missing from that node
- **Sync** — click to rsync a model from one node to the others via SSH *(admin only)*
- **Delete** — click trash icons to select models for deletion, then confirm *(admin only)*

## Activity

Shows active operations:

- Download progress (from HuggingFace)
- Sync progress (rsync between nodes)
- Queue status
- History of completed operations

## Cluster Nodes

Per-node details:

- RAM usage
- GPU utilization %
- Temperature
- Power consumption (watts)
- SSD free space

## Model Management

Load, unload, and configure models using the **exo Dashboard** link. This opens exo's native interface for direct model management.
