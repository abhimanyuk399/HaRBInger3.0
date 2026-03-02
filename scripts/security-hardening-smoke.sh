#!/usr/bin/env bash
set -uo pipefail

FAIL_COUNT=0
WARN_COUNT=0
RESULTS=()
LAST_HTTP_STATUS=""
LAST_HTTP_BODY=""

KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:8080}"
FI_BASE_URL="${FI_BASE_URL:-http://localhost:3005}"
WALLET_BASE_URL="${WALLET_BASE_URL:-http://localhost:3004}"

env_get() {
  local key="$1"
  if [[ ! -f .env ]]; then
    echo ""
    return
  fi
  awk -F= -v k="$key" '
    BEGIN { found = "" }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      key = $1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == k) {
        sub(/^[^=]*=/, "", $0)
        gsub(/\r$/, "", $0)
        found = $0
      }
    }
    END { print found }
  ' .env
}

urlencode() {
  jq -nr --arg v "$1" '$v|@uri'
}

json_call() {
  local method="$1"
  local url="$2"
  local token="${3:-}"
  local body="${4:-}"
  local response

  if [[ -n "$token" && -n "$body" ]]; then
    response="$(curl -sS --max-time 10 -X "$method" "$url" -H "Accept: application/json" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data "$body" -w $'\n%{http_code}')"
  elif [[ -n "$token" ]]; then
    response="$(curl -sS --max-time 10 -X "$method" "$url" -H "Accept: application/json" -H "Authorization: Bearer $token" -w $'\n%{http_code}')"
  elif [[ -n "$body" ]]; then
    response="$(curl -sS --max-time 10 -X "$method" "$url" -H "Accept: application/json" -H "Content-Type: application/json" --data "$body" -w $'\n%{http_code}')"
  else
    response="$(curl -sS --max-time 10 -X "$method" "$url" -H "Accept: application/json" -w $'\n%{http_code}')"
  fi

  LAST_HTTP_STATUS="${response##*$'\n'}"
  LAST_HTTP_BODY="${response%$'\n'*}"
}

add_result() {
  local check="$1"
  local level="$2"
  local detail="$3"
  RESULTS+=("$check|$level|$detail")
  if [[ "$level" == "FAIL" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  elif [[ "$level" == "WARN" ]]; then
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
}

print_results() {
  printf '\n%-40s %-6s %s\n' "Check" "Level" "Detail"
  printf '%-40s %-6s %s\n' "-----" "-----" "------"
  local row check level detail
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r check level detail <<<"$row"
    printf '%-40s %-6s %s\n' "$check" "$level" "$detail"
  done
}

get_client_token() {
  local realm="$1"
  local client_id="$2"
  local client_secret="$3"
  local token_response token
  token_response="$(curl -sS -X POST "$KEYCLOAK_BASE_URL/realms/$realm/protocol/openid-connect/token" \
    --max-time 10 \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "grant_type=client_credentials&client_id=$(urlencode "$client_id")&client_secret=$(urlencode "$client_secret")")"
  token="$(printf '%s' "$token_response" | jq -r '.access_token // empty')"
  printf '%s' "$token"
}

decode_jwt_payload() {
  local token="$1"
  local payload raw pad decoded
  payload="$(printf '%s' "$token" | cut -d'.' -f2)"
  raw="${payload//-/+}"
  raw="${raw//_/\//}"
  pad=$(( (4 - ${#raw} % 4) % 4 ))
  while [[ "$pad" -gt 0 ]]; do
    raw="${raw}="
    pad=$((pad - 1))
  done
  decoded="$(printf '%s' "$raw" | base64 -d 2>/dev/null || true)"
  printf '%s' "$decoded"
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

if [[ ! -f .env ]]; then
  echo ".env not found in current directory." >&2
  exit 1
fi

REALM="bharat-kyc-dev"
FI_CLIENT_ID="$(env_get KEYCLOAK_FI_CLIENT_ID)"
[[ -z "$FI_CLIENT_ID" ]] && FI_CLIENT_ID="fi-client"
FI_SECRET="$(env_get KEYCLOAK_FI_CLIENT_SECRET)"
UID_VALUE="$(env_get VITE_WALLET_OWNER_USER_ID)"
[[ -z "$UID_VALUE" ]] && UID_VALUE="wallet-owner-1"

if [[ -z "$FI_SECRET" ]]; then
  echo "Missing KEYCLOAK_FI_CLIENT_SECRET in .env" >&2
  exit 1
fi

FI_ACCESS="$(get_client_token "$REALM" "$FI_CLIENT_ID" "$FI_SECRET")"
if [[ -z "$FI_ACCESS" ]]; then
  add_result "FI client credentials valid" "FAIL" "Unable to mint fi-client token."
  print_results
  exit 1
fi
add_result "FI client credentials valid" "PASS" "Token minted"

# 1) No token -> wallet endpoint should be unauthorized.
json_call GET "$WALLET_BASE_URL/v1/wallet/$UID_VALUE/consents" "" ""
if [[ "$LAST_HTTP_STATUS" == "401" || "$LAST_HTTP_STATUS" == "403" ]]; then
  add_result "Wallet endpoint rejects unauthenticated access" "PASS" "HTTP $LAST_HTTP_STATUS"
else
  add_result "Wallet endpoint rejects unauthenticated access" "FAIL" "Expected 401/403, got HTTP $LAST_HTTP_STATUS"
fi

# 2) FI token should not be accepted for owner delegation create.
EXPIRY_UTC="$(perl -MPOSIX -e 'print strftime("%Y-%m-%dT%H:%M:%SZ", gmtime(time()+2*24*3600))')"
DELEG_PAYLOAD="$(jq -n --arg uid "$UID_VALUE" --arg exp "$EXPIRY_UTC" '{ownerUserId:$uid,delegateUserId:"wallet-nominee-1",scope:"consent.approve",allowedPurposes:["insurance-claim"],allowedFields:["fullName","dob"],expiresAt:$exp}')"
json_call POST "$WALLET_BASE_URL/v1/wallet/delegations" "$FI_ACCESS" "$DELEG_PAYLOAD"
if [[ "$LAST_HTTP_STATUS" == "401" || "$LAST_HTTP_STATUS" == "403" ]]; then
  add_result "Role isolation (FI token blocked from wallet owner action)" "PASS" "HTTP $LAST_HTTP_STATUS"
else
  add_result "Role isolation (FI token blocked from wallet owner action)" "FAIL" "Expected 401/403, got HTTP $LAST_HTTP_STATUS"
fi

# 3) Invalid client secret should fail token endpoint.
BAD_TOKEN_BODY="$(curl -sS -X POST "$KEYCLOAK_BASE_URL/realms/$REALM/protocol/openid-connect/token" \
  --max-time 10 \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=client_credentials&client_id=$(urlencode "$FI_CLIENT_ID")&client_secret=definitely-invalid-secret" -w $'\n%{http_code}')"
BAD_TOKEN_STATUS="${BAD_TOKEN_BODY##*$'\n'}"
if [[ "$BAD_TOKEN_STATUS" == "400" || "$BAD_TOKEN_STATUS" == "401" ]]; then
  add_result "Invalid client secret rejected" "PASS" "HTTP $BAD_TOKEN_STATUS"
else
  add_result "Invalid client secret rejected" "FAIL" "Expected 400/401, got HTTP $BAD_TOKEN_STATUS"
fi

# 4) No ACTIVE token guard.
NO_TOKEN_PAYLOAD='{"userId":"USER-NO-TOKEN-SECURITY","fiId":"fi-client","purpose":"account-opening","requestedFields":["fullName"],"ttlSeconds":300,"requiresDelegation":false}'
json_call POST "$FI_BASE_URL/v1/fi/request-kyc" "$FI_ACCESS" "$NO_TOKEN_PAYLOAD"
if [[ "$LAST_HTTP_STATUS" == "404" && "$LAST_HTTP_BODY" == *"No ACTIVE token found for user"* ]]; then
  add_result "Consent creation blocked without ACTIVE token" "PASS" "HTTP 404 with clear error"
else
  add_result "Consent creation blocked without ACTIVE token" "FAIL" "HTTP $LAST_HTTP_STATUS body=$(printf '%s' "$LAST_HTTP_BODY" | tr -d '\n' | cut -c1-120)"
fi

# 5) Token lifetime sanity check.
TOKEN_PAYLOAD_JSON="$(decode_jwt_payload "$FI_ACCESS")"
TOKEN_IAT="$(printf '%s' "$TOKEN_PAYLOAD_JSON" | jq -r '.iat // empty')"
TOKEN_EXP="$(printf '%s' "$TOKEN_PAYLOAD_JSON" | jq -r '.exp // empty')"
if [[ "$TOKEN_IAT" =~ ^[0-9]+$ && "$TOKEN_EXP" =~ ^[0-9]+$ ]]; then
  TOKEN_LIFETIME=$((TOKEN_EXP - TOKEN_IAT))
  MAX_TOKEN_LIFETIME="${MAX_TOKEN_LIFETIME_SECONDS:-7200}"
  if [[ "$TOKEN_LIFETIME" -le "$MAX_TOKEN_LIFETIME" ]]; then
    add_result "Token lifetime sanity" "PASS" "lifetime=${TOKEN_LIFETIME}s"
  else
    add_result "Token lifetime sanity" "WARN" "lifetime=${TOKEN_LIFETIME}s exceeds max=${MAX_TOKEN_LIFETIME}s"
  fi
else
  add_result "Token lifetime sanity" "WARN" "Could not parse iat/exp from FI token."
fi

# 6) Rate-limit probe (informational if not configured).
RATE_LIMIT_HITS=0
BURST_COUNT="${RATE_LIMIT_BURST_COUNT:-25}"
for _ in $(seq 1 "$BURST_COUNT"); do
  status="$(curl -sS -X POST "$KEYCLOAK_BASE_URL/realms/$REALM/protocol/openid-connect/token" \
    --max-time 10 \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "grant_type=client_credentials&client_id=$(urlencode "$FI_CLIENT_ID")&client_secret=definitely-invalid-secret" \
    -o /dev/null -w '%{http_code}')"
  if [[ "$status" == "429" ]]; then
    RATE_LIMIT_HITS=$((RATE_LIMIT_HITS + 1))
  fi
done
if [[ "$RATE_LIMIT_HITS" -gt 0 ]]; then
  add_result "Rate-limit probe" "PASS" "429 observed $RATE_LIMIT_HITS/$BURST_COUNT attempts"
else
  add_result "Rate-limit probe" "WARN" "No 429 observed in $BURST_COUNT attempts (rate limiting may be disabled)."
fi

print_results
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
