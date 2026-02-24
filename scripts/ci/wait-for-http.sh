#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <url> [attempts] [sleep_seconds]" >&2
  exit 2
fi

url="$1"
attempts="${2:-90}"
sleep_seconds="${3:-2}"

for ((i = 1; i <= attempts; i++)); do
  if curl -fsS "$url" >/dev/null; then
    echo "Ready: $url"
    exit 0
  fi
  echo "Waiting ($i/$attempts): $url"
  sleep "$sleep_seconds"
done

echo "Timed out waiting for $url" >&2
exit 1
