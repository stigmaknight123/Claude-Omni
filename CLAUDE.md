# CLAUDE.md

`claude-omni` runs Claude Code against any OpenAI-compatible provider (OpenCode
Zen/Go, OpenRouter, Groq, Cerebras, Gemini, Mistral, Together, NVIDIA, Hugging
Face) via a local proxy. To set it up for the user, follow `PROMPT.md`: ask which
provider they want and that provider's key, run `./install.sh`, add the key to
`~/.zen-claude/.env`, then `./verify.sh --full`, and tell them
`claude-omni --<provider>`.

Hard rules: keep `zen-proxy.mjs`'s `reasoning_content` cache/stub-retry and its
tool-schema filter verbatim (they're load-bearing); other edits are fine. Never
commit or print API keys.
