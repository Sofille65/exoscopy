# ExoScopy — Downloads Screen (HuggingFace)

> Search and download MLX models from HuggingFace.
> Download activity (progress, queue, history) is on the Dashboard.

---

## Layout

Full page: search bar + filters + results list.

## Header

- Title: "Downloads"
- Subtitle: "Search and download models on HuggingFace"
- Link: ↗ huggingface.com (external)

## Search

- **Search field** — text input with Search button
- **Direct download** — paste HuggingFace repo ID (e.g. `mlx-community/ModelName`) + ↓ button

## Filters

All on one row:

### Format
- Fixed **MLX** badge (exo only uses MLX, no safetensors/gguf option)

### Quant (dynamic dropdown)
- Populated from search results (e.g. 4-bit, 8-bit, bf16)
- Cross-filters with Parameters: selecting 8-bit hides parameters not available in 8-bit
- Empty = All

### Parameters (dynamic dropdown)
- Populated from search results (e.g. 1B, 8B, 70B, 397B)
- Cross-filters with Quant: selecting 70B hides quants not available for 70B
- Empty = All

### Sort
- Dropdown: Popularity (default), Date, Likes, Size
- Direction toggle: ↓ (desc) / ↑ (asc)

### Apply
- Button triggers new search with filters baked into HF API query

## Results

Each result card:
- Model name (bold)
- **MLX** badge (amber, always)
- Quant badge (gray) — e.g. "8-bit"
- Precision badge (gray) — e.g. "bf16"
- Parameters badge (gray) — e.g. "397B"
- **↗ HF link** — opens model page on huggingface.co
- Author (mono, muted)
- Estimated size (mono) — e.g. "~369.7 GB"
- Download count — e.g. "↓ 62.2K"
- **Download** button (yellow)

## Download behavior
- Click Download → model added to download queue
- Max 3 concurrent downloads
- Progress visible on Dashboard page
- Queue auto-starts when slot frees up
