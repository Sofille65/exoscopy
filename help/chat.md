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

## Features

- **File attachments** — 📎 button to attach .py, .js, .md, .json and more — injected as code blocks in your message
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
