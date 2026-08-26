# Installation prompt

This is the prompt used to set `claude-zen` up on a fresh machine with an AI
coding assistant. Paste it into your assistant of choice, swap in your own key,
and it will walk through clone → install → verify → launch.

```text
Set up Claude Code on this machine to run DeepSeek V4 Flash for free through
OpenCode Zen.

Repo:  https://github.com/stigmaknight123/claude-zen

My OpenCode Zen API key:  sk-<your-zen-api-key>

Steps:
1. Clone the repo somewhere sensible and read its README first.
2. Run ./install.sh and give it my key when it asks.
3. Run ./verify.sh --full and paste me the full output.
4. Tell me the exact command to start it.

Rules:
- Do NOT rewrite or "improve" zen-proxy.mjs. The repo copy is correct. Two
  parts of it are load-bearing and break in non-obvious ways if touched: the
  reasoning_content cache with its stub retry, and the tool-schema filter.
- Check ~/.claude/settings.json for pinned ANTHROPIC_*_MODEL values. If any
  exist, tell me — they override env vars and will silently break the launcher.
- If a step fails, debug and fix it, then re-run verify.sh.
- Do not tell me it works until verify.sh passes end to end.
```

> Never commit a real key. The `sk-<your-zen-api-key>` placeholder keeps this
> file safe to share in a public repo.
