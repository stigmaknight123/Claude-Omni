#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Preserve caller-supplied overrides (e.g. OpenRouter key/base) over .env.
_call_key="${ZEN_API_KEY:-}"
_call_base="${ZEN_BASE_URL:-}"
set -a; source ./.env; set +a
[ -n "$_call_key" ] && export ZEN_API_KEY="$_call_key" || true
[ -n "$_call_base" ] && export ZEN_BASE_URL="$_call_base" || true
export PORT="${PORT:-8787}"
exec node zen-proxy.mjs
