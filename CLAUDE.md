# CLAUDE.md

`claude-zen` runs Claude Code against OpenCode Zen/Go/OpenRouter via a local
proxy. To set it up for the user, follow `PROMPT.md`: ask for their Zen API key,
run `./install.sh`, then `./verify.sh --full`, and tell them to run `claude-zen`.

Hard rules: keep `zen-proxy.mjs`'s `reasoning_content` cache/stub-retry and its
tool-schema filter verbatim (they're load-bearing); other edits are fine. Never
commit or print API keys.
