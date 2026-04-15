# Downloads

The Downloads tab lets you search and download models from HuggingFace directly to your cluster nodes.

## Search

- Search HuggingFace for MLX models (exo qualified only)
- **Filters** — Quant type and Parameters dropdowns, dynamically cross-filtered from results
- **Sort** — by Popularity, Date, Likes, or Size (toggle direction with ↑↓)

## Download Modes

- **Node 1 only** — downloads to the primary node only
- **Distributed** — downloads to the primary node, then auto-rsyncs to all other nodes

## Direct Download

Paste a HuggingFace repo ID (e.g. `mlx-community/ModelName`) in the direct download field and click ↓ to start downloading immediately.

## Download Queue

- Maximum 3 concurrent downloads
- Progress bar shown at the bottom of the page
- Downloads persist across page refreshes

## Tips

- Click the ↗ icon on any search result to view it on HuggingFace
- Results stay when switching pages — click "Clear results" to reset
- Models must be installed on ALL nodes to be loaded on the cluster — use Sync on the Dashboard to distribute
