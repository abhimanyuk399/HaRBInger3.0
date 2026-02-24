#!/usr/bin/env bash
set -uo pipefail

FAIL_COUNT=0
WARN_COUNT=0
RESULTS=()

TOTAL_REQUESTS="${TOTAL_REQUESTS:-60}"
CONCURRENCY="${CONCURRENCY:-8}"
P95_WARN_SECONDS="${P95_WARN_SECONDS:-1.20}"

add_result() {
  local target="$1"
  local level="$2"
  local detail="$3"
  RESULTS+=("$target|$level|$detail")
  if [[ "$level" == "FAIL" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  elif [[ "$level" == "WARN" ]]; then
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
}

print_results() {
  printf '\n%-28s %-6s %s\n' "Service" "Level" "Detail"
  printf '%-28s %-6s %s\n' "-------" "-----" "------"
  local row service level detail
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r service level detail <<<"$row"
    printf '%-28s %-6s %s\n' "$service" "$level" "$detail"
  done
}

run_endpoint() {
  local label="$1"
  local url="$2"
  local tmp_file
  local precheck_status
  tmp_file="$(mktemp)"

  precheck_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [[ ! "$precheck_status" =~ ^2 ]]; then
    add_result "$label" "FAIL" "endpoint unreachable (HTTP ${precheck_status:-000})"
    rm -f "$tmp_file"
    return
  fi

  seq 1 "$TOTAL_REQUESTS" \
    | xargs -I{} -P "$CONCURRENCY" sh -c "curl -sS --max-time 5 -o /dev/null -w '%{http_code} %{time_total}\n' '$url' 2>/dev/null" \
    >"$tmp_file"

  local success failures count avg p95
  success="$(awk '$1 ~ /^2/ { c++ } END { print c+0 }' "$tmp_file")"
  failures=$((TOTAL_REQUESTS - success))
  count="$(awk 'NF>=2 { c++ } END { print c+0 }' "$tmp_file")"
  avg="$(awk 'NF>=2 { sum += $2; c++ } END { if(c==0) print 0; else printf "%.4f", (sum/c) }' "$tmp_file")"
  p95="$(awk 'NF>=2 { print $2 }' "$tmp_file" | sort -n | awk '
    { a[++n]=$1 }
    END {
      if (n == 0) {
        print 0;
        exit;
      }
      idx = int((n * 95 + 99) / 100);
      if (idx < 1) idx = 1;
      if (idx > n) idx = n;
      printf "%.4f", a[idx];
    }'
  )"

  rm -f "$tmp_file"

  if [[ "$count" -eq 0 ]]; then
    add_result "$label" "FAIL" "No samples collected."
    return
  fi

  if [[ "$failures" -gt 0 ]]; then
    add_result "$label" "FAIL" "failures=$failures/$TOTAL_REQUESTS avg=${avg}s p95=${p95}s"
    return
  fi

  awk -v p95="$p95" -v warn="$P95_WARN_SECONDS" 'BEGIN { exit !(p95 > warn) }'
  if [[ "$?" -eq 0 ]]; then
    add_result "$label" "WARN" "avg=${avg}s p95=${p95}s (warn>${P95_WARN_SECONDS}s)"
  else
    add_result "$label" "PASS" "avg=${avg}s p95=${p95}s"
  fi
}

if ! command -v curl >/dev/null 2>&1; then
  echo "Missing required command: curl" >&2
  exit 1
fi
if ! command -v xargs >/dev/null 2>&1; then
  echo "Missing required command: xargs" >&2
  exit 1
fi
if ! command -v awk >/dev/null 2>&1; then
  echo "Missing required command: awk" >&2
  exit 1
fi
if ! command -v sort >/dev/null 2>&1; then
  echo "Missing required command: sort" >&2
  exit 1
fi

run_endpoint "issuer-service" "${ISSUER_BASE_URL:-http://localhost:3001}/v1/health?probe=readiness"
run_endpoint "registry-service" "${REGISTRY_BASE_URL:-http://localhost:3002}/v1/health?probe=readiness"
run_endpoint "consent-manager" "${CONSENT_BASE_URL:-http://localhost:3003}/v1/health?probe=readiness"
run_endpoint "wallet-service" "${WALLET_BASE_URL:-http://localhost:3004}/v1/health?probe=readiness"
run_endpoint "fi-service" "${FI_BASE_URL:-http://localhost:3005}/v1/health?probe=readiness"
run_endpoint "ckyc-adapter" "${CKYC_BASE_URL:-http://localhost:3006}/v1/health?probe=readiness"
run_endpoint "review-scheduler" "${REVIEW_BASE_URL:-http://localhost:3007}/v1/health?probe=readiness"

print_results
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
