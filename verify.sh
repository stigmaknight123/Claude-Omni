#!/usr/bin/env bash
# Proves the setup actually works. Exits nonzero on the first real failure.
#
#   ./verify.sh            # checks a-e (fast)
#   ./verify.sh --full     # also runs f: real Claude Code, end to end
set -uo pipefail

DIR="$HOME/.zen-claude"
PORT="${ZEN_PROXY_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
MODEL="${DEFAULT_ZEN_MODEL:-deepseek-v4-flash-free}"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
info() { printf '        %s\n' "$1"; }

KEY="$(grep '^ZEN_API_KEY=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$KEY" ] || { echo "no key in $DIR/.env -- run install.sh first"; exit 1; }

echo ""
echo "Verifying claude-omni"
echo ""

# ---- a: proxy health -----------------------------------------------------
if ! curl -sf --max-time 3 "$BASE/health" >/dev/null 2>&1; then
  info "proxy down, starting it..."
  nohup "$DIR/start.sh" >>"$DIR/proxy.log" 2>&1 &
  for _ in $(seq 1 40); do curl -sf --max-time 2 "$BASE/health" >/dev/null 2>&1 && break; sleep 0.5; done
fi
if curl -sf --max-time 3 "$BASE/health" 2>/dev/null | grep -q '"ok"'; then
  ok "a  proxy is up on $BASE"
else
  no "a  proxy will not start -- see $DIR/proxy.log"
  exit 1
fi

# ---- b: the bug this proxy exists for ------------------------------------
# Zen's own /v1/messages shim mangles tool schemas. If it ever starts working,
# the proxy becomes unnecessary -- so this is informational, not a failure.
SHIM="$(curl -s --max-time 30 https://opencode.ai/zen/v1/messages \
  -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":600,
       \"tools\":[{\"name\":\"bash\",\"description\":\"run\",\"input_schema\":
         {\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"}}}}],
       \"messages\":[{\"role\":\"user\",\"content\":\"list files, use bash\"}]}" 2>/dev/null)"
# The error text varies by which upstream channel Zen routes to (one is Rust
# and says "missing field `name`", another is pydantic and says "Field
# required"), so match on the outcome rather than the wording.
if printf '%s' "$SHIM" | grep -q '"content"'; then
  ok "b  heads up: Zen's /v1/messages answered -- the proxy may be optional now"
  info "if this keeps happening, try ANTHROPIC_BASE_URL=https://opencode.ai/zen directly"
elif printf '%s' "$SHIM" | grep -q '"error"'; then
  ok "b  Zen's native /v1/messages still mangles tool schemas (proxy required)"
else
  no "b  unexpected reply from Zen's /v1/messages"
  info "$(printf '%s' "$SHIM" | head -c 200)"
fi

# ---- c: tool translation -------------------------------------------------
TOOLS="$(curl -s --max-time 60 "$BASE/v1/messages" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":900,
       \"tools\":[{\"name\":\"ls\",\"description\":\"List files in a directory\",
         \"input_schema\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},
         \"required\":[\"path\"]}}],
       \"messages\":[{\"role\":\"user\",\"content\":\"List the files in /tmp. Use the ls tool.\"}]}" 2>/dev/null)"
if printf '%s' "$TOOLS" | grep -q '"type":"tool_use"'; then
  ok "c  Anthropic tool schema translates and the model calls the tool"
else
  no "c  no tool_use block returned"
  info "$(printf '%s' "$TOOLS" | head -c 200)"
fi

# ---- d: multi-turn with a tool result ------------------------------------
CYCLE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$BASE/v1/messages" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":900,\"messages\":[
       {\"role\":\"user\",\"content\":\"List /tmp with the ls tool.\"},
       {\"role\":\"assistant\",\"content\":[
         {\"type\":\"text\",\"text\":\"Checking.\"},
         {\"type\":\"tool_use\",\"id\":\"toolu_01\",\"name\":\"ls\",\"input\":{\"path\":\"/tmp\"}}]},
       {\"role\":\"user\",\"content\":[
         {\"type\":\"tool_result\",\"tool_use_id\":\"toolu_01\",\"content\":\"a.txt\"}]},
       {\"role\":\"user\",\"content\":\"Summarize in one short sentence.\"}]}" 2>/dev/null)"
[ "$CYCLE" = "200" ] && ok "d  tool_use -> tool_result round trip" \
                     || no "d  round trip returned HTTP $CYCLE"

# ---- e: THE restart test -------------------------------------------------
# b/c/d all pass even with a broken reasoning cache, because the proxy has just
# seen those turns and still holds them in memory. The real failure mode is a
# COLD cache: restart, then replay turns the proxy has never seen.
PID="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
[ -n "$PID" ] && kill "$PID" 2>/dev/null
sleep 1
nohup "$DIR/start.sh" >>"$DIR/proxy.log" 2>&1 &
for _ in $(seq 1 40); do curl -sf --max-time 2 "$BASE/health" >/dev/null 2>&1 && break; sleep 0.5; done

COLD="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$BASE/v1/messages" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":900,\"messages\":[
       {\"role\":\"user\",\"content\":\"What is 2+2? Just the number.\"},
       {\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"4\"}]},
       {\"role\":\"user\",\"content\":\"Times 3? Just the number.\"}]}" 2>/dev/null)"
if [ "$COLD" = "200" ]; then
  ok "e  cold-cache replay after restart (the one that used to break)"
  tail -5 "$DIR/proxy.log" | grep -q 'reasoning replay' \
    && info "recovery fired and worked -- that's a pass, not a failure"
else
  no "e  cold-cache replay returned HTTP $COLD"
  info "the reasoning_content stub retry is missing or broken"
fi

# ---- f: real Claude Code -------------------------------------------------
if [ "$FULL" = 1 ]; then
  if command -v claude-omni >/dev/null 2>&1; then
    T="$(mktemp -d)"; echo "codeword: BANANA-42" > "$T/secret.txt"
    OUT="$(cd "$T" && claude-omni -p "Read secret.txt and tell me the codeword." \
             --allowedTools Read --permission-mode acceptEdits 2>&1 || true)"
    printf '%s' "$OUT" | grep -q 'BANANA-42' \
      && ok "f  real Claude Code read a file through DeepSeek" \
      || { no "f  end-to-end run did not return the codeword"; info "$(printf '%s' "$OUT" | tail -3)"; }
    rm -rf "$T"
  else
    no "f  claude-omni not on PATH"
  fi
else
  info "skipping f (real Claude Code) -- re-run with --full to include it"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  printf '  \033[32m%d passed, 0 failed.\033[0m  Start with: claude-omni\n\n' "$pass"
  exit 0
fi
printf '  \033[31m%d passed, %d failed.\033[0m\n\n' "$pass" "$fail"
exit 1
