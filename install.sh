#!/usr/bin/env bash
# Installs the Zen bridge into ~/.zen-claude and the launcher into ~/.local/bin.
# Safe to re-run; it overwrites the code and leaves your key alone.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.zen-claude"
BIN="$HOME/.local/bin"

say()  { printf '  %s\n' "$1"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; }
die()  { printf '  \033[31mfail\033[0m %s\n' "$1" >&2; exit 1; }

echo ""
echo "Installing claude-zen"
echo ""

# ---- prerequisites -------------------------------------------------------
command -v node >/dev/null 2>&1 || die "node is not installed (need v18+)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node v18+ required (found v$NODE_MAJOR) -- needs built-in fetch"
ok "node v$(node -p 'process.versions.node')"

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"
ok "python3"

if command -v claude >/dev/null 2>&1; then
  ok "claude on PATH"
else
  say "warn Claude Code is not on PATH yet."
  say "     Install it first: https://claude.com/claude-code"
fi

# ---- api key -------------------------------------------------------------
KEY="${ZEN_API_KEY:-${1:-}}"
if [ -z "$KEY" ] && [ -f "$DIR/.env" ]; then
  KEY="$(grep '^ZEN_API_KEY=' "$DIR/.env" | cut -d= -f2- || true)"
  [ -n "$KEY" ] && say "using the key already in $DIR/.env"
fi
if [ -z "$KEY" ]; then
  echo ""
  say "Get a free key at https://opencode.ai -- it looks like sk-<61 chars>"
  printf '  OpenCode Zen API key: '
  read -r KEY
fi

case "$KEY" in
  sk-*) ;;
  *) die "that doesn't look like a Zen key (should start with sk-)" ;;
esac
[ "${#KEY}" -ge 32 ] || die "that key looks too short to be real"

# Optional OpenRouter key (only needed for `claude-zen --openrouter`).
ORKEY="${OPENROUTER_API_KEY:-}"
if [ -z "$ORKEY" ] && [ -f "$DIR/.env" ]; then
  ORKEY="$(grep '^OPENROUTER_API_KEY=' "$DIR/.env" | cut -d= -f2- || true)"
  [ -n "$ORKEY" ] && say "using the OpenRouter key already in $DIR/.env"
fi
if [ -z "$ORKEY" ]; then
  echo ""
  say "Optional: an OpenRouter key (https://openrouter.ai) enables --openrouter."
  printf '  OpenRouter API key (Enter to skip): '
  read -r ORKEY || true
fi
if [ -n "$ORKEY" ]; then
  case "$ORKEY" in
    sk-*) ;;
    *) die "that doesn't look like an OpenRouter key (should start with sk-)" ;;
  esac
fi

# ---- write files ---------------------------------------------------------
mkdir -p "$DIR" "$BIN"

# Preserve a custom ZEN_BASE_URL across re-installs.
BASE="$(grep '^ZEN_BASE_URL=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)"

{
  printf 'ZEN_API_KEY=%s\n' "$KEY"
  [ -n "$ORKEY" ] && printf 'OPENROUTER_API_KEY=%s\n' "$ORKEY"
  [ -n "$BASE" ] && printf 'ZEN_BASE_URL=%s\n' "$BASE"
} > "$DIR/.env"
chmod 600 "$DIR/.env"
ok "wrote $DIR/.env (chmod 600)"

install -m 644 "$SRC/zen-proxy.mjs" "$DIR/zen-proxy.mjs"
install -m 755 "$SRC/start.sh"      "$DIR/start.sh"
install -m 755 "$SRC/bin/claude-zen" "$BIN/claude-zen"
install -m 644 "$SRC/completions/claude-zen.bash" "$DIR/claude-zen.bash"
printf '%s\n' "$SRC" > "$DIR/.repo-path"
ok "installed proxy + launcher + completion"

# ---- PATH ----------------------------------------------------------------
case ":$PATH:" in
  *":$BIN:"*) ok "$BIN is on PATH" ;;
  *)
    say "warn $BIN is not on your PATH. Add this to your shell profile:"
    say "       export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

# ---- settings.json conflict ---------------------------------------------
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ] && grep -q 'ANTHROPIC_.*MODEL' "$SETTINGS" 2>/dev/null; then
  echo ""
  say "note ~/.claude/settings.json pins ANTHROPIC_*_MODEL values."
  say "     Those override environment variables, so claude-zen passes the"
  say "     model as a CLI flag to beat them. Nothing to fix -- just so you"
  say "     know why plain \`claude\` and \`claude-zen\` behave differently."
fi

echo ""
echo "Done. Next:"
echo ""
echo "    ./verify.sh        # prove it works"
echo "    claude-zen         # start coding"
echo ""
