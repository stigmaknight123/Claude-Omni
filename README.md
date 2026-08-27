# Claude-Omni

Run **Claude Code** against any OpenAI-compatible provider — OpenCode Zen/Go,
OpenRouter, Groq, Cerebras, Gemini, Mistral, Together, NVIDIA, and Hugging Face —
through a small local proxy that translates their API into the Anthropic protocol
Claude Code speaks. Defaults to Zen's free `deepseek-v4-flash-free` ($0).

## Why use it

- **$0 to run.** Point Claude Code at free models — DeepSeek V4 Flash and others —
  with no Anthropic API key or per-token billing.
- **Full Claude Code experience.** Tools, file editing, permissions, and the
  agentic loop all work unchanged; only the model behind it changes.
- **Ten providers, one command.** Switch between OpenCode Zen/Go, OpenRouter,
  Groq, Cerebras, Gemini, Mistral, Together, NVIDIA, and Hugging Face with a flag.
- **Self-healing.** If a model is down or rate-limited, `claude-omni` falls back
  to a live one at launch *and* auto-swaps mid-session when free usage runs out.

## Install

```bash
git clone https://github.com/stigmaknight123/Claude-Omni
cd Claude-Omni
./install.sh          # asks for your Zen API key
./verify.sh           # proves it works
claude-omni            # start coding
```

That's it — the proxy auto-starts if it isn't running.

Get a Zen key at [opencode.ai](https://opencode.ai) (looks like `sk-` plus 61
characters). The other providers need their own keys — see [API keys](#api-keys).

### API keys

All keys live in `~/.zen-claude/.env`:

```bash
ZEN_API_KEY=sk-...        # Zen + Go (same key; Go bills your subscription)
OPENROUTER_API_KEY=...    # --openrouter
GROQ_API_KEY=...          # --groq
CEREBRAS_API_KEY=...      # --cerebras
GEMINI_API_KEY=...        # --gemini (AI Studio)
MISTRAL_API_KEY=...       # --mistral
TOGETHER_API_KEY=...      # --together
NVIDIA_API_KEY=...        # --nvidia
HF_TOKEN=...              # --huggingface
```

Only add the keys for providers you actually use.

The launcher picks the right key per provider. `ZEN_BASE_URL` can override the
upstream endpoint if you ever need a custom relay.

## Install with an AI assistant

The simplest way: point an AI coding agent (Claude Code, OpenCode, Codex,
Copilot, …) at this repo and ask it to set up `claude-omni`. It reads
[`AGENTS.md`](AGENTS.md) (or [`CLAUDE.md`](CLAUDE.md)) automatically, so it knows
to run `install.sh` and `verify.sh --full` — it'll ask which provider you want and
collect that provider's API key.

Prefer to drive it yourself? [`PROMPT.md`](PROMPT.md) holds a ready-to-paste
prompt: copy the block, swap in your provider and key, and paste it into any
assistant.

## Requirements

macOS or Linux, Node 18+, Python 3, and Claude Code installed. Windows works
under WSL only.

> Unofficial community tool. Not affiliated with or endorsed by Anthropic,
> OpenCode, or OpenRouter. Free tiers and model lineups can change or disappear
> at any time.

## Usage

```bash
claude-omni                          # interactive; resumes your last provider/model
claude-omni -m hy3-free              # pick a specific model
claude-omni -p "explain this bug"    # one-shot, no TUI
claude-omni --status                 # probe every model: responding / rate-limited / dead
claude-omni --list                   # just the model ids for the current provider
claude-omni --doctor                 # check node/python3/claude, key, proxy, model
claude-omni --update                 # git-pull and re-run install.sh
claude-omni --reset                  # forget the remembered provider/model
claude-omni --uninstall              # remove ~/.zen-claude and the launcher
claude-omni --version                # print the version
```

A bare `claude-omni` remembers the last provider and model you used (stored in
`~/.zen-claude/.state`); use `--reset` to clear it.

`claude-omni` also auto-updates on launch — it fetches the repo and re-installs
if a newer commit is available. Set `CLAUDE_OMNI_NO_UPDATE=1` to disable.

### Providers

Pick the provider with a flag (default is Zen):

| Flag            | Provider      | Cost        |
| --------------- | ------------- | ----------- |
| `--zen`         | OpenCode Zen  | free / PAYG |
| `--go`          | OpenCode Go   | $10/month   |
| `--openrouter`  | OpenRouter    | free        |
| `--groq`        | Groq          | free tier   |
| `--cerebras`    | Cerebras      | free tier   |
| `--gemini`      | Google Gemini | free tier   |
| `--mistral`     | Mistral       | free tier   |
| `--together`    | Together AI   | free models |
| `--nvidia`      | NVIDIA NIM    | free trial  |
| `--huggingface` | Hugging Face  | free tier   |

```bash
claude-omni --go                                    # Go → deepseek-v4-flash
claude-omni --openrouter                            # OpenRouter free models
claude-omni --groq                                  # Groq → llama-3.3-70b-versatile
claude-omni --gemini -m gemini-2.0-flash            # a specific Gemini model
claude-omni --zen                                   # back to Zen (default)
```

Zen, Go, and OpenRouter list their models live. The other providers use a small
curated list of known-free models (kept in `preferred()` in `bin/claude-omni`) —
edit it to add your own.

### Model fallback

If the model you asked for isn't responding, `claude-omni` probes the catalog and
falls back to the first live model, trying a provider-specific priority list
first. Override the order with `ZEN_PREFERRED` (space-separated model ids):

```bash
ZEN_PREFERRED="hy3-free nemotron-3-ultra-free" claude-omni
```

Anything after those flags is passed straight through to `claude`, so
`claude-omni --permission-mode acceptEdits` and friends all work.

**The `/model` picker won't list these models.** Switching means quitting and
relaunching with a different `-m`. That's a Claude Code limitation.

### Shell completion

`install.sh` drops a bash completion into `~/.zen-claude/claude-omni.bash`. Enable
it with:

```bash
source ~/.zen-claude/claude-omni.bash
```

(or add that line to `~/.bashrc`). Then `claude-omni <TAB>` completes the flags,
and `claude-omni -m <TAB>` completes the model ids.

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
subscription with `claude-omni --go`. Run `claude-omni --status` for the list.

**`The reasoning_content in the thinking mode must be passed back`**
An old copy of the proxy. Pull the latest and re-run `./install.sh`.

**`Unable to connect to API (ConnectionRefused)`**
You ran `claude`, not `claude-omni`. The launcher starts the proxy for you.

**Model answers nothing, `"stop_reason":"max_tokens"`**
Reasoning models spend their token budget thinking before emitting text. Not a
bug — raise `max_tokens`.

**`claude.ai connectors are disabled because ANTHROPIC_API_KEY ... is set`**
Expected. The launcher sets `ANTHROPIC_AUTH_TOKEN` to reach the local proxy.
Harmless in this mode.

**It works with `claude-omni` but plain `claude` behaves oddly**
An `env` block in `~/.claude/settings.json` overrides exported environment
variables. `claude-omni` beats it by passing the model as a CLI flag. If that
file pins `ANTHROPIC_*_MODEL` values from some earlier setup, they're still
affecting your normal `claude` sessions.

**A free model stopped working**
Free lineups rotate constantly and dead entries stay listed in the catalog
(Zen's `*-free` and OpenRouter's `:free` alike). `claude-omni` probes the model
on launch and falls back to the first live one (preferred models first). Force a
specific model with `-m`, or set `ZEN_PREFERRED` to reorder the fallback.

---

## What gets installed

```
~/.zen-claude/.env           your API keys (chmod 600, never committed)
~/.zen-claude/zen-proxy.mjs  the bridge
~/.zen-claude/start.sh       runs the proxy on :8787
~/.zen-claude/proxy.log      upstream errors land here
~/.local/bin/claude-omni      the launcher
```

Uninstall: `rm -rf ~/.zen-claude ~/.local/bin/claude-omni`

## License

MIT
