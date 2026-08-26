# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this is

`claude-omni` runs Claude Code against any OpenAI-compatible provider — OpenCode
Zen/Go, OpenRouter, Groq, Cerebras, Gemini, Mistral, Together, NVIDIA, and
Hugging Face — through a small local proxy that translates their API into the
Anthropic protocol Claude Code speaks. See `README.md` for details.

## Setting it up for the user

If the user wants to install or set up `claude-omni`, follow `PROMPT.md`:

1. Ask the user for their OpenCode Zen API key — never read it from the repo,
   the environment, or anywhere else; it is a secret the user must provide.
2. Run `./install.sh` and pass the key when it asks.
3. Run `./verify.sh --full` and show the user the full output.
4. Tell the user the launch command: `claude-omni`.

## Hard rules

- `zen-proxy.mjs` has two load-bearing parts that must stay verbatim: the
  `reasoning_content` cache/stub-retry and the
  `.filter((t) => t.name && t.input_schema)` tool filter. Don't touch those;
  other changes (e.g. the free-usage fallback) are fine.
- Never commit, print, or log API keys. Keys live in `~/.zen-claude/.env`.
