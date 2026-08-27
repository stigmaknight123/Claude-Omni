# Installation prompt

This is the prompt used to set `claude-omni` up on a fresh machine with an AI
coding assistant. Paste it into your assistant of choice, swap in your provider
and key, and it will walk through clone → install → verify → launch.

```text
Set up Claude Code to run through claude-omni using the provider of my choice.

Repo:  https://github.com/stigmaknight123/Claude-Omni

Provider: <zen | go | openrouter | groq | cerebras | gemini | mistral | together | nvidia | huggingface>
My API key: <the key for that provider>

Steps:
1. Clone the repo somewhere sensible and read its README first.
2. Run ./install.sh (if I'm using Zen/Go, give it the Zen key when it asks).
3. Put my provider key in ~/.zen-claude/.env under the right variable name:
   zen/go -> ZEN_API_KEY, openrouter -> OPENROUTER_API_KEY,
   groq -> GROQ_API_KEY, cerebras -> CEREBRAS_API_KEY, gemini -> GEMINI_API_KEY,
   mistral -> MISTRAL_API_KEY, together -> TOGETHER_API_KEY,
   nvidia -> NVIDIA_API_KEY, huggingface -> HF_TOKEN.
4. Run ./verify.sh --full and paste me the full output.
5. Tell me the exact command to start it (claude-omni --<provider>).

Rules:
- Do NOT rewrite or "improve" zen-proxy.mjs. The repo copy is correct. Two
  parts of it are load-bearing and break in non-obvious ways if touched: the
  reasoning_content cache with its stub retry, and the tool-schema filter.
- Check ~/.claude/settings.json for pinned ANTHROPIC_*_MODEL values. If any
  exist, tell me — they override env vars and will silently break the launcher.
- If a step fails, debug and fix it, then re-run verify.sh.
- Do not tell me it works until verify.sh passes end to end.
```

> Never commit a real key. The `<your-key>` placeholder keeps this file safe to
> share in a public repo.

## Optional: open in VS Code

Append this step to the prompt if you want Claude Code running inside VS Code
instead of a plain terminal:

```text
5. (Optional) Open claude-omni in VS Code. Easiest route: open a WSL terminal
   in VS Code and run `claude-omni` — no extra setup, the launcher configures
   itself. For the Claude Code panel instead: install the "Claude Code"
   extension, open a WSL window, and add an `env` block to
   `~/.claude/settings.json` setting `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`,
   `ANTHROPIC_AUTH_TOKEN=zen-local-proxy`, and your model — otherwise the panel
   bypasses the proxy and talks to Anthropic directly.
```
