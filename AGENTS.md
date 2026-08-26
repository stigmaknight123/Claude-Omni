# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this is

`claude-zen` runs Claude Code against OpenCode Zen, OpenCode Go, or OpenRouter
through a small local proxy that translates their OpenAI-style API into the
Anthropic protocol Claude Code speaks. See `README.md` for details.

## Setting it up for the user

If the user wants to install or set up `claude-zen`, follow `PROMPT.md`:

1. Ask the user for their OpenCode Zen API key — never read it from the repo,
   the environment, or anywhere else; it is a secret the user must provide.
2. Run `./install.sh` and pass the key when it asks.
3. Run `./verify.sh --full` and show the user the full output.
4. Tell the user the launch command: `claude-zen`.

## Hard rules

- Never rewrite or "improve" `zen-proxy.mjs`. Its `reasoning_content` cache and
  stub retry, and its `.filter((t) => t.name && t.input_schema)` tool filter,
  are load-bearing and fail intermittently if touched.
- Never commit, print, or log API keys. Keys live in `~/.zen-claude/.env`.
