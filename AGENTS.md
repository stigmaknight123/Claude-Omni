# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this is

`claude-omni` runs Claude Code against any OpenAI-compatible provider — OpenCode
Zen/Go, OpenRouter, Groq, Cerebras, Gemini, Mistral, Together, NVIDIA, and
Hugging Face — through a small local proxy that translates their API into the
Anthropic protocol Claude Code speaks. See `README.md` for details.

## Setting it up for the user

If the user wants to install or set up `claude-omni`, follow `PROMPT.md`:

1. Ask the user which provider they want to use, then ask for that provider's
   API key — never read it from the repo, the environment, or anywhere else.
2. Run `./install.sh` (pass the Zen key if they use Zen/Go).
3. Add their provider key to `~/.zen-claude/.env` under the right name
   (`ZEN_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`,
   `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `NVIDIA_API_KEY`,
   `HF_TOKEN`).
4. Run `./verify.sh --full` and show the user the full output.
5. Tell the user the launch command: `claude-omni --<provider>`.

## Hard rules

- `zen-proxy.mjs` has two load-bearing parts that must stay verbatim: the
  `reasoning_content` cache/stub-retry and the
  `.filter((t) => t.name && t.input_schema)` tool filter. Don't touch those;
  other changes (e.g. the free-usage fallback) are fine.
- Never commit, print, or log API keys. Keys live in `~/.zen-claude/.env`.
