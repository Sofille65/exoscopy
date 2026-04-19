# Chat

The Chat tab is your main interface for interacting with models running on your exo cluster.

## Basics

- **New chat** — click "+ New chat" in the sidebar
- **Model selector** — dropdown shows installed models (⚡ = currently loaded)
- **Enter** to send, **Shift+Enter** for new line, **Cmd+K** / **Ctrl+K** for new chat

## Inference Settings

Click the gear icon to configure:

- **Presets** — Creative (temp 1.2), Normal (temp 0.7), Code (temp 0.2)
- **Temperature** — controls randomness (0 = deterministic, 2 = very random)
- **Top P / Top K / Min P** — token sampling parameters
- **Max tokens** — limit response length
- **Repetition penalty** — reduce repetitive outputs
- **Seed** — set for reproducible responses
- **Thinking mode** — enable for models that support reasoning (e.g. Qwen3.5). Thinking blocks are shown in real-time during streaming.
- **Reasoning effort** — none, minimal, low, medium, high, xhigh

## System Prompt

Toggle ON/OFF in the chat header. You can:

- Write a custom system prompt
- Save multiple prompts with names
- Export/import prompts as JSON
- When a **Project** is active, the project's system prompt replaces the session prompt automatically

## Projects

Organize conversations into projects:

- Click **Projects** in the sidebar header
- Create a project with a name, category, and optional system prompt
- When a project is selected, only its conversations are shown
- The project system prompt is sent automatically with every message
- Edit a project anytime with the ⚙ icon on hover

## Multimodal Inference — Images and PDFs

> **Requires**: exo v1.0.70+ on your cluster AND a vision-capable model loaded (👁 icon in the dropdown).

Supported vision models include **Gemma 4**, **Qwen3-VL**, and **Kimi K2.5** (install via the Downloads tab).

### Images

1. Click the 📎 attach button
2. Pick one or more image files (`.png`, `.jpg`, `.webp`, `.gif`, …)
3. A **thumbnail** appears below the input — click × to remove
4. Type your question ("What's in this image?", "Read the text", "Describe the scene")
5. Send — the image is passed to the model alongside your prompt

The image is sent as base64 directly — nothing is uploaded to any third-party service. Max recommended size: 2000×2000 px (larger images are accepted but use more tokens).

### PDFs

1. Click 📎 and choose a `.pdf` file
2. ExoScopy **extracts text + rasterizes each page** into an image, all in your browser (offline)
3. A spinner shows progress ("Page 3/12") — wait for it to finish
4. Once ready, you see a **thumbnail** of the first page + page count
5. Ask anything: "Summarize this document", "What does page 5 say?", "Translate the intro to English"

**Why both text AND image?** Text extraction works perfectly on native PDFs, while the rendered image captures diagrams, tables, handwriting, and scanned pages. Belt and suspenders — best accuracy.

**Limits**:
- Maximum **20 pages** per PDF (larger PDFs are truncated, you'll see "N of M" in the label)
- Encrypted PDFs aren't supported
- Scanned (image-only) PDFs work — the model reads the rasterized pages directly

### Tips for vision inference

- **Ask specific questions** — "what's the title of this book?" gets better answers than "describe this"
- **Multi-language OCR works** — vision models read Chinese, Arabic, Cyrillic, etc.
- **Combine text + image** — "Explain the diagram in this PDF and translate the French caption"
- **Warning banner** — if you attach an image while a non-vision model is selected, a yellow banner reminds you to switch

### What if I don't see vision models?

- Check your exo version: `exo --version` on any node must be **≥ 1.0.70**
- Models must be downloaded: go to **Downloads**, search "Gemma" or "Qwen3-VL", install
- Once installed, the model shows a **👁** icon in the chat dropdown

## Features

- **File attachments** — 📎 button to attach code files (`.py`, `.js`, `.md`, `.json`, …), images, or PDFs. Code files are injected as code blocks; images and PDFs are sent as multimodal content (vision models only).
- **Multi-turn editing** — hover a user message → pencil icon → edit and regenerate from that point
- **Stats** — TTFT, speed (tk/s), tokens, generation time shown after each response
- **Copy / Save** — hover over a response to copy markdown or save as .md file
- **Code blocks** — save individual code blocks as files, or all as .zip
- **Pin conversations** — hover a conversation → Pin/Unpin (pinned stay on top)
- **Export** — hover a conversation in sidebar → ↓ MD or ↓ JSON

## Cloud Models (OpenRouter)

If an OpenRouter API key is configured in Settings:

- An **EXO / Cloud** toggle appears next to the model dropdown
- Switch to **Cloud** to browse models from OpenAI, Anthropic, Google, Meta, Mistral, and more
- Models are grouped by provider in the dropdown
- Get your API key at [openrouter.ai](https://openrouter.ai)
