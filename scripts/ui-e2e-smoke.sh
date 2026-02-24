#!/usr/bin/env bash
set -euo pipefail

UI_BASE_URL="${UI_BASE_URL:-http://localhost:5173}"

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

check_route() {
  local path="$1"
  local url="${UI_BASE_URL}${path}"
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' "$url")"
  if [[ "$status" =~ ^[23] ]]; then
    printf '%-28s PASS (%s)\n' "$path" "$status"
    return 0
  fi

  printf '%-28s FAIL (%s)\n' "$path" "$status"
  return 1
}

require_cmd curl

failures=0
for route in /login /wallet/login /fi/login /command/login; do
  if ! check_route "$route"; then
    failures=$((failures + 1))
  fi
done

if [[ "$failures" -gt 0 ]]; then
  echo "UI smoke check failed: $failures route(s) unreachable" >&2
  exit 1
fi

echo "UI smoke check passed"
