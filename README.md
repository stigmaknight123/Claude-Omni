# claude-zen

Run **Claude Code** against OpenCode Zen, OpenCode Go, or OpenRouter — a small
local proxy that translates their OpenAI-style API into the Anthropic protocol
Claude Code speaks.

Defaults to Zen's free `deepseek-v4-flash-free`. Cost: $0.

> Unofficial community tool. Not affiliated with or endorsed by Anthropic,
> OpenCode, or OpenRouter. Free tiers and model lineups can change or disappear
> at any time.

**Requirements:** macOS or Linux, Node 18+, Python 3, and Claude Code installed.
Windows works under WSL only.

---

## Install

```bash
git clone https://github.com/stigmaknight123/claude-zen
cd claude-zen
./install.sh          # asks for your Zen API key
./verify.sh           # proves it works
```

Get a Zen key at [opencode.ai](https://opencode.ai) (looks like `sk-` plus 61
characters). For `--openrouter` you'll also need a key from
[openrouter.ai](https://openrouter.ai) — see [API keys](#api-keys).

Then:

```bash
claude-zen
```

That's it. The proxy auto-starts if it isn't running.

### API keys

All keys live in `~/.zen-claude/.env`:

```bash
ZEN_API_KEY=sk-...                 # Zen + Go (same key; Go bills your subscription)
OPENROUTER_API_KEY=sk-or-v1-...    # only needed for --openrouter
```

The launcher picks the right key per provider. `ZEN_BASE_URL` can override the
upstream endpoint if you ever need a custom relay.

## Usage

```bash
claude-zen                          # interactive, default provider/model
claude-zen -m hy3-free              # pick a specific model
claude-zen -p "explain this bug"    # one-shot, no TUI
claude-zen --status                 # proxy state + live model list
```

### Providers

Pick the provider with a flag (default is Zen):

| Flag            | Provider     | Models                          | Cost        |
| --------------- | ------------ | ------------------------------- | ----------- |
| `--zen`         | OpenCode Zen | `*-free` and pay-per-credit     | free / PAYG |
| `--go`          | OpenCode Go  | subscription (DeepSeek, Kimi…)  | $10/month   |
| `--openrouter`  | OpenRouter   | `:free` models                  | free        |

```bash
claude-zen --go                                     # Go → deepseek-v4-flash
claude-zen --go -m kimi-k3                          # a specific Go model
claude-zen --openrouter                             # OpenRouter free models
claude-zen --openrouter -m "nvidia/nemotron-3-ultra-550b-a55b:free"
claude-zen --zen                                    # back to Zen (default)
```

### Model fallback

If the model you asked for isn't responding, `claude-zen` probes the catalog and
falls back to the first live model, trying a provider-specific priority list
first. Override the order with `ZEN_PREFERRED` (space-separated model ids):

```bash
ZEN_PREFERRED="hy3-free nemotron-3-ultra-free" claude-zen
```

Anything after those flags is passed straight through to `claude`, so
`claude-zen --permission-mode acceptEdits` and friends all work.

**The `/model` picker won't list these models.** Switching means quitting and
relaunching with a different `-m`. That's a Claude Code limitation.

---

## Why a proxy is needed

The obvious setup — pointing `ANTHROPIC_BASE_URL` straight at
`https://opencode.ai/zen` — does not work.

Zen's Anthropic-compatible `/v1/messages` endpoint mangles tool schemas when it
translates them to OpenAI format, dropping `function.name`:

```
Failed to deserialize the JSON body into the target type:
tools[0].function: missing field `name`
```

The models themselves do tool calling perfectly — the identical request to
`/v1/chat/completions` returns a correct `tool_calls` response. Only the
Anthropic shim is broken. Claude Code sends tool definitions on *every* request
and has no tools-off mode, so this fails every single turn. It doesn't degrade
into a working chat box; it just dies.

So `zen-proxy.mjs` sits in between and does the translation properly.

`verify.sh` re-checks this on every run. If Zen ever fixes their shim, step (b)
tells you the proxy has become optional.

---

## Two parts of `zen-proxy.mjs` that must not be "cleaned up"

If you or an AI assistant refactors this file, keep these. Both fail in
non-obvious, intermittent ways.

### 1. The `reasoning_content` cache and its stub fallback

DeepSeek V4 is a reasoning model. Replay an assistant turn without its original
`reasoning_content` and the request is rejected:

```
The `reasoning_content` in the thinking mode must be passed back to the API
```

Claude Code has no field for this, so the proxy remembers it and re-attaches it
— keyed by `tool_call` id for turns that called tools, and by a hash of the
reply text for turns that didn't (those have no id to key on).

The cache alone is not enough:

- It lives in memory, so **restarting the proxy empties it** while Claude Code
  keeps replaying a conversation whose turns it has never seen. That wedges
  every later turn permanently, not just once.
- **Only some of Zen's upstream channels enforce the rule**, so identical
  traffic passes for a while and then fails, which reads as random.

That's what `fillReasoningStubs` and the one-shot retry handle: on a 400
mentioning `reasoning_content`, every assistant turn still missing one gets a
placeholder and the request goes again (which also re-rolls the channel). Real
cached reasoning always wins; stubs only fill gaps.

`verify.sh` step (e) is the regression test — it restarts the proxy and replays
a cold conversation. Steps (c) and (d) pass even with a completely broken cache,
because the proxy just saw those turns. Only (e) catches it.

### 2. `.filter((t) => t.name && t.input_schema)` on the tools array

Claude Code sends server-side tool stubs that carry no schema. Forwarding those
reproduces the exact upstream error this proxy exists to avoid.

---

## Troubleshooting

**`CreditsError: No payment method` / `Insufficient balance`**
You asked for a pay-per-credit Zen model without a balance. Use a `-free` model,
add credits at [opencode.ai/zen](https://opencode.ai/zen), or use your
subscription with `claude-zen --go`. Run `claude-zen --status` for the list.

**`The reasoning_content in the thinking mode must be passed back`**
An old copy of the proxy. Pull the latest and re-run `./install.sh`.

**`Unable to connect to API (ConnectionRefused)`**
You ran `claude`, not `claude-zen`. The launcher starts the proxy for you.

**Model answers nothing, `"stop_reason":"max_tokens"`**
Reasoning models spend their token budget thinking before emitting text. Not a
bug — raise `max_tokens`.

**`claude.ai connectors are disabled because ANTHROPIC_API_KEY ... is set`**
Expected. The launcher sets `ANTHROPIC_AUTH_TOKEN` to reach the local proxy.
Harmless in this mode.

**It works with `claude-zen` but plain `claude` behaves oddly**
An `env` block in `~/.claude/settings.json` overrides exported environment
variables. `claude-zen` beats it by passing the model as a CLI flag. If that
file pins `ANTHROPIC_*_MODEL` values from some earlier setup, they're still
affecting your normal `claude` sessions.

**A free model stopped working**
Free lineups rotate constantly and dead entries stay listed in the catalog
(Zen's `*-free` and OpenRouter's `:free` alike). `claude-zen` probes the model
on launch and falls back to the first live one (preferred models first). Force a
specific model with `-m`, or set `ZEN_PREFERRED` to reorder the fallback.

---

## What gets installed

```
~/.zen-claude/.env           your API keys (chmod 600, never committed)
~/.zen-claude/zen-proxy.mjs  the bridge
~/.zen-claude/start.sh       runs the proxy on :8787
~/.zen-claude/proxy.log      upstream errors land here
~/.local/bin/claude-zen      the launcher
```

Uninstall: `rm -rf ~/.zen-claude ~/.local/bin/claude-zen`

## License

MIT
