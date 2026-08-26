# CLAUDE.md

`claude-zen` runs Claude Code against OpenCode Zen/Go/OpenRouter via a local
proxy. To set it up for the user, follow `PROMPT.md`: ask for their Zen API key,
run `./install.sh`, then `./verify.sh --full`, and tell them to run `claude-zen`.

Hard rules: never rewrite `zen-proxy.mjs` (its reasoning cache and tool filter
are load-bearing), and never commit or print API keys.
