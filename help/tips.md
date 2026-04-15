# Tips & Troubleshooting

## Quick Tips

- exo's native dashboard is available via the **↗ exo Dashboard** link in the nav bar
- Thinking mode (Qwen3.5) is OFF by default — enable in Inference Settings if needed
- Models must be installed on **all nodes** to be loaded on the cluster — use Sync on the Dashboard to distribute
- The download queue supports max 3 concurrent downloads from HuggingFace
- **Cmd+K** / **Ctrl+K** creates a new chat from anywhere

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Enter | Send message |
| Shift+Enter | New line |
| Cmd+K / Ctrl+K | New chat |

## Troubleshooting

### Chat not responding

1. Check that exo is running on your nodes
2. Verify the EXO Endpoint in Settings (Test button)
3. Check that a model is loaded (status bar shows "Running")

### Models not showing

- Models need to be downloaded first (Downloads tab)
- Ensure exo can see the model files in `~/.exo/models/`
- Try refreshing the model list

### SSH / Sync issues

- Ensure Remote Login is enabled on macOS nodes (System Settings → General → Sharing)
- Re-run **Setup SSH Keys** in Settings
- Run **Config Check** to identify the problem

### Slow inference

- Check GPU% and RAM% on the Dashboard — high usage may indicate contention
- Try Pipeline sharding (better for most models) vs Tensor sharding
- Ensure RDMA/Thunderbolt connections are active (shown in Space View)
