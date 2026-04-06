# ExoScopy — Backlog v1.2

> À faire avant de partager le projet publiquement.

---

## Must-have (v1.2 — next session)

### 1. Auto-distribute after HF download
- After download completes on one node → auto-trigger rsync to other nodes
- Or: option in Downloads page to select target nodes before download
- Currently: user must manually click Sync on Dashboard after download

### 2. Download feedback
- Download button changes state after click (spinner/disabled/"Downloading...")
- Toast or redirect to Dashboard to show progress
- Badge on Dashboard nav tab when downloads are active

### 3. Thinking mode display
- Show `<think>` blocks during streaming (not just after)
- Collapsible, italic, muted style (already CSS-ready: `.think-block`)
- Handle `reasoning_content` from exo SSE (Qwen3.5 native thinking)

### 4. Logo in nav bar
- Add Space Invader logo (from `logo/`) next to "ExoScopy" text in nav
- Already designed in Paper

### 5. Dark mode toggle
- Light by default (current)
- Toggle in nav bar or Settings
- CSS variables for theme switching

---

## Nice to have (v1.1+ / future)

### Chat enhancements
- [ ] File attachments (📎) — multi-file, inject as code blocks
- [ ] Multi-turn editing — edit previous user message, regenerate from that point
- [ ] Conversation pinning UI (backend already supports `pinned` field)
- [ ] Search across all conversations
- [ ] Keyboard shortcuts (Cmd+K new chat, Cmd+Enter send)

### Monitoring
- [ ] Space View SVG topology (was in original Paper design, removed for simplicity)
- [ ] Metrics history — time-series graphs (GPU%, RAM, tok/s over time)

### Benchmark
- [ ] Benchmark panel — measure TTFT + tokens/sec on cluster
- [ ] Compare models, save results

### UX
- [ ] Mobile responsive (CSS-only)
- [ ] PWA support (Add to Home Screen)
- [ ] Notifications (download complete, sync complete)

### Infrastructure
- [ ] Pipelined download+sync (rsync file-by-file as HF download progresses, don't wait for full download)
- [ ] Model disk usage per node (du -sh via SSH)
- [ ] Persist deletedModels to disk (currently in-memory, lost on restart)
- [ ] Health check endpoint for monitoring
