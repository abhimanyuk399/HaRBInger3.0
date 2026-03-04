#!/usr/bin/env bash
set -uo pipefail

LAST_HTTP_STATUS=""
LAST_HTTP_BODY=""
FAIL_COUNT=0
RESULTS=()

KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:8080}"
ISSUER_BASE_URL="${ISSUER_BASE_URL:-http://localhost:3001}"
FI_BASE_URL="${FI_BASE_URL:-http://localhost:3005}"
WALLET_BASE_URL="${WALLET_BASE_URL:-http://localhost:3004}"
CKYC_BASE_URL="${CKYC_BASE_URL:-http://localhost:3006}"
REVIEW_BASE_URL="${REVIEW_BASE_URL:-http://localhost:3007}"
WALLET_REDIRECT_URI="${WALLET_REDIRECT_URI:-http://localhost:5173/wallet/login}"

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

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

get_header_location() {
  awk 'BEGIN{IGNORECASE=1} /^Location:/ {loc=$2} END {gsub(/\r/,"",loc); print loc}' "$1"
}

get_header_status() {
  awk 'NR==1 {print $2; exit}' "$1"
}

urldecode() {
  local data="${1//+/ }"
  printf '%b' "${data//%/\\x}"
}

extract_auth_error_from_location() {
  local location="$1"
  local error_raw desc_raw error_decoded desc_decoded
  error_raw="$(printf '%s' "$location" | sed -n 's/.*[?&]error=\([^&]*\).*/\1/p')"
  desc_raw="$(printf '%s' "$location" | sed -n 's/.*[?&]error_description=\([^&]*\).*/\1/p')"
  if [[ -z "$error_raw" && -z "$desc_raw" ]]; then
    return 0
  fi

  error_decoded="$error_raw"
  desc_decoded="$desc_raw"
  [[ -n "$error_raw" ]] && error_decoded="$(urldecode "$error_raw")"
  [[ -n "$desc_raw" ]] && desc_decoded="$(urldecode "$desc_raw")"

  if [[ -n "$error_decoded" && -n "$desc_decoded" ]]; then
    printf '%s: %s' "$error_decoded" "$desc_decoded"
  elif [[ -n "$error_decoded" ]]; then
    printf '%s' "$error_decoded"
  else
    printf '%s' "$desc_decoded"
  fi
}

extract_keycloak_login_action() {
  local html_path="$1"
  local action
  action="$(perl -0777 -ne 'if(/<form[^>]*action=(["\x27])([^"\x27]*login-actions\/authenticate[^"\x27]*)\1/si){print $2}' "$html_path")"
  if [[ -z "$action" ]]; then
    action="$(perl -0777 -ne 'if(/id=(["\x27])kc-form-login\1[\s\S]*?action=(["\x27])([^"\x27]+)\2/si){print $3}' "$html_path")"
  fi
  printf '%s' "$action"
}

extract_keycloak_page_error() {
  local html_path="$1"
  local page_error
  page_error="$(perl -0777 -ne '
    if(/id="input-error"[^>]*>\s*([^<]+)/si){print $1; exit}
    if(/id="kc-page-title"[^>]*>\s*([^<]+)/si){print $1; exit}
  ' "$html_path")"
  page_error="$(printf '%s' "$page_error" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//')"
  printf '%s' "$page_error"
}

normalize_keycloak_host() {
  local url="$1"
  local base_origin path
  base_origin="$(printf '%s' "$KEYCLOAK_BASE_URL" | sed -E 's#(https?://[^/]+).*#\1#')"
  if [[ "$url" == /* ]]; then
    printf '%s%s' "$base_origin" "$url"
    return 0
  fi
  if [[ "$url" =~ ^https?://[^/]+(/.*)$ ]]; then
    path="${BASH_REMATCH[1]}"
    printf '%s%s' "$base_origin" "$path"
    return 0
  fi
  printf '%s' "$url"
}

new_pkce_pair() {
  PKCE_VERIFIER="$(openssl rand -base64 64 | tr '+/' '-_' | tr -d '=' | tr -d '\r\n')"
  PKCE_CHALLENGE="$(printf '%s' "$PKCE_VERIFIER" | openssl dgst -binary -sha256 | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
}

get_user_access_token() {
  local realm="$1"
  local client_id="$2"
  local username="$3"
  local password="$4"
  local redirect_uri="$5"

  new_pkce_pair

  local work_dir headers1 headers2 cookies body1 body2 auth_url location action post_data code_raw code token_resp token status1 status2 auth_error page_error
  work_dir="$(mktemp -d)"
  headers1="$work_dir/h1.txt"
  headers2="$work_dir/h2.txt"
  cookies="$work_dir/cookies.txt"
  body1="$work_dir/body1.html"
  body2="$work_dir/body2.html"

  auth_url="$KEYCLOAK_BASE_URL/realms/$realm/protocol/openid-connect/auth?client_id=$(urlencode "$client_id")&redirect_uri=$(urlencode "$redirect_uri")&response_type=code&scope=openid&code_challenge_method=S256&code_challenge=$PKCE_CHALLENGE&prompt=login&login_hint=$(urlencode "$username")"

  curl -sS -D "$headers1" -c "$cookies" "$auth_url" -o "$body1" >/dev/null
  location="$(get_header_location "$headers1")"
  status1="$(get_header_status "$headers1")"

  if [[ -n "$location" ]]; then
    auth_error="$(extract_auth_error_from_location "$location")"
    if [[ -n "$auth_error" ]]; then
      rm -rf "$work_dir"
      echo "Keycloak auth rejected for $username: $auth_error (client=$client_id redirect_uri=$redirect_uri)" >&2
      return 1
    fi
  fi

  if [[ -z "$location" ]]; then
    if [[ -n "$status1" && "$status1" -ge 400 ]]; then
      page_error="$(extract_keycloak_page_error "$body1")"
      rm -rf "$work_dir"
      if [[ -n "$page_error" ]]; then
        echo "Keycloak auth page error for $username: HTTP $status1 ($page_error)" >&2
      else
        echo "Keycloak auth page error for $username: HTTP $status1" >&2
      fi
      return 1
    fi

    action="$(extract_keycloak_login_action "$body1")"
    action="${action//&amp;/&}"
    if [[ -z "$action" ]]; then
      rm -rf "$work_dir"
      echo "Keycloak login action not found for $username" >&2
      return 1
    fi
    action="$(normalize_keycloak_host "$action")"
    post_data="username=$(urlencode "$username")&password=$(urlencode "$password")&credentialId="
    curl -sS -D "$headers2" -b "$cookies" -c "$cookies" -X POST \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data "$post_data" "$action" -o "$body2" >/dev/null
    location="$(get_header_location "$headers2")"
    status2="$(get_header_status "$headers2")"
    if [[ -z "$location" && -n "$status2" && "$status2" -ge 400 ]]; then
      page_error="$(extract_keycloak_page_error "$body2")"
      rm -rf "$work_dir"
      if [[ -n "$page_error" ]]; then
        echo "Keycloak login failed for $username: HTTP $status2 ($page_error)" >&2
      else
        echo "Keycloak login failed for $username: HTTP $status2" >&2
      fi
      return 1
    fi
  fi

  if [[ -n "$location" ]]; then
    auth_error="$(extract_auth_error_from_location "$location")"
    if [[ -n "$auth_error" ]]; then
      rm -rf "$work_dir"
      echo "Keycloak login redirect error for $username: $auth_error" >&2
      return 1
    fi
  fi

  if [[ -z "$location" ]]; then
    rm -rf "$work_dir"
    echo "Keycloak redirect missing for $username" >&2
    return 1
  fi

  code_raw="$(printf '%s' "$location" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
  if [[ -z "$code_raw" ]]; then
    rm -rf "$work_dir"
    echo "Authorization code missing for $username. redirect=$location" >&2
    return 1
  fi
  code="$(urldecode "$code_raw")"

  token_resp="$(curl -sS -X POST "$KEYCLOAK_BASE_URL/realms/$realm/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "grant_type=authorization_code&client_id=$(urlencode "$client_id")&code=$(urlencode "$code")&redirect_uri=$(urlencode "$redirect_uri")&code_verifier=$(urlencode "$PKCE_VERIFIER")")"
  token="$(printf '%s' "$token_resp" | jq -r '.access_token // empty')"
  rm -rf "$work_dir"

  if [[ -z "$token" ]]; then
    echo "Failed to obtain user access token for $username: $token_resp" >&2
    return 1
  fi

  printf '%s' "$token"
}

get_client_access_token() {
  local realm="$1"
  local client_id="$2"
  local secret="$3"
  local token_resp token

  token_resp="$(curl -sS -X POST "$KEYCLOAK_BASE_URL/realms/$realm/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "grant_type=client_credentials&client_id=$(urlencode "$client_id")&client_secret=$(urlencode "$secret")")"
  token="$(printf '%s' "$token_resp" | jq -r '.access_token // empty')"
  if [[ -z "$token" ]]; then
    echo "Failed to obtain client access token for $client_id: $token_resp" >&2
    return 1
  fi
  printf '%s' "$token"
}

json_call() {
  local method="$1"
  local url="$2"
  local token="${3:-}"
  local body="${4:-}"
  local response

  if [[ -n "$token" && -n "$body" ]]; then
    response="$(curl -sS -X "$method" "$url" -H "Accept: application/json" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data "$body" -w $'\n%{http_code}')"
  elif [[ -n "$token" ]]; then
    response="$(curl -sS -X "$method" "$url" -H "Accept: application/json" -H "Authorization: Bearer $token" -w $'\n%{http_code}')"
  elif [[ -n "$body" ]]; then
    response="$(curl -sS -X "$method" "$url" -H "Accept: application/json" -H "Content-Type: application/json" --data "$body" -w $'\n%{http_code}')"
  else
    response="$(curl -sS -X "$method" "$url" -H "Accept: application/json" -w $'\n%{http_code}')"
  fi

  LAST_HTTP_STATUS="${response##*$'\n'}"
  LAST_HTTP_BODY="${response%$'\n'*}"

  if [[ "$LAST_HTTP_STATUS" =~ ^2 ]]; then
    printf '%s' "$LAST_HTTP_BODY"
    return 0
  fi
  return 1
}

detect_wallet_actor_id() {
  local token="$1"
  local fallback="$2"
  shift 2
  local candidate encoded

  for candidate in "$@"; do
    [[ -z "$candidate" ]] && continue
    encoded="$(urlencode "$candidate")"
    if json_call GET "$WALLET_BASE_URL/v1/wallet/$encoded/delegations" "$token" "" >/dev/null; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  printf '%s' "$fallback"
}

add_result() {
  local scenario="$1"
  local result="$2"
  local detail="$3"
  RESULTS+=("$scenario|$result|$detail")
  if [[ "$result" != "PASS" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

print_results() {
  printf '\n%-28s %-6s %s\n' "Scenario" "Result" "Detail"
  printf '%-28s %-6s %s\n' "--------" "------" "------"
  local row scenario result detail
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r scenario result detail <<<"$row"
    printf '%-28s %-6s %s\n' "$scenario" "$result" "$detail"
  done
}

require_cmd curl
require_cmd jq
require_cmd openssl
require_cmd perl

if [[ ! -f .env ]]; then
  echo ".env not found in current directory." >&2
  exit 1
fi

REALM="bharat-kyc-dev"
UID_VALUE="$(env_get VITE_WALLET_OWNER_USER_ID)"
WALLET_USER="$(env_get KEYCLOAK_WALLET_OWNER_USER)"
WALLET_PASS="$(env_get KEYCLOAK_WALLET_OWNER_PASSWORD)"
NOMINEE_USER="$(env_get KEYCLOAK_NOMINEE_USER)"
NOMINEE_PASS="$(env_get KEYCLOAK_NOMINEE_PASSWORD)"
FI_CLIENT_ID="$(env_get KEYCLOAK_FI_CLIENT_ID)"
FI2_CLIENT_ID="$(env_get KEYCLOAK_FI2_CLIENT_ID)"
FI_SECRET="$(env_get KEYCLOAK_FI_CLIENT_SECRET)"
FI2_SECRET="$(env_get KEYCLOAK_FI2_CLIENT_SECRET)"
ISSUER_SECRET="$(env_get ISSUER_ADMIN_CLIENT_SECRET)"

[[ -z "$UID_VALUE" ]] && UID_VALUE="$(env_get KEYCLOAK_WALLET_OWNER_USER_ID)"
[[ -z "$UID_VALUE" ]] && UID_VALUE="KYC-1234"
[[ -z "$FI_CLIENT_ID" ]] && FI_CLIENT_ID="fi-client"
[[ -z "$FI2_CLIENT_ID" ]] && FI2_CLIENT_ID="fi-client-2"

if [[ -z "$WALLET_USER" || -z "$WALLET_PASS" || -z "$NOMINEE_USER" || -z "$NOMINEE_PASS" || -z "$FI_SECRET" || -z "$FI2_SECRET" || -z "$ISSUER_SECRET" ]]; then
  echo "Missing required values in .env (wallet/nominee users, FI secrets, issuer secret)." >&2
  exit 1
fi

ISSUER_ACCESS="$(get_client_access_token "$REALM" "issuer-admin" "$ISSUER_SECRET")" || exit 1
FI_ACCESS="$(get_client_access_token "$REALM" "$FI_CLIENT_ID" "$FI_SECRET")" || exit 1
FI2_ACCESS="$(get_client_access_token "$REALM" "$FI2_CLIENT_ID" "$FI2_SECRET")" || exit 1
WALLET_ACCESS="$(get_user_access_token "$REALM" "wallet-client" "$WALLET_USER" "$WALLET_PASS" "$WALLET_REDIRECT_URI")" || exit 1
NOMINEE_ACCESS="$(get_user_access_token "$REALM" "wallet-client" "$NOMINEE_USER" "$NOMINEE_PASS" "$WALLET_REDIRECT_URI")" || exit 1
WALLET_ACTOR_ID="$(detect_wallet_actor_id "$WALLET_ACCESS" "$UID_VALUE" "$UID_VALUE" "$WALLET_USER" "KYC-1234")"

S1_CONSENT_ID=""
S1_ASSERTION_JWT=""

# S0 Issue Token
S0_PAYLOAD="$(jq -n --arg uid "$UID_VALUE" '{kyc:{fullName:"Enterprise User",dob:"1990-01-01",idNumber:$uid,email:"enterprise.user@example.local",phone:"+919000000001",addressLine1:"Navi Mumbai",pincode:"400706"},ttlSeconds:1800}')"
if S0_RESP="$(json_call POST "$ISSUER_BASE_URL/v1/issuer/kyc/issue" "$ISSUER_ACCESS" "$S0_PAYLOAD")"; then
  add_result "S0 Issue Token" "PASS" "$(printf '%s' "$S0_RESP" | jq -r '.tokenId // "missing-tokenId"')"
else
  add_result "S0 Issue Token" "FAIL" "HTTP $LAST_HTTP_STATUS"
fi

# S1 Owner Approve + Verify
S1_REQ_PAYLOAD="$(jq -n --arg uid "$UID_VALUE" '{userId:$uid,fiId:"fi-client",purpose:"account-opening",requestedFields:["fullName","dob","idNumber"],ttlSeconds:600,requiresDelegation:false}')"
if S1_REQ="$(json_call POST "$FI_BASE_URL/v1/fi/request-kyc" "$FI_ACCESS" "$S1_REQ_PAYLOAD")"; then
  S1_CONSENT_ID="$(printf '%s' "$S1_REQ" | jq -r '.consentId // empty')"
  if [[ -n "$S1_CONSENT_ID" ]]; then
    S1_APPROVE_PAYLOAD='{"reason":"Approved by owner"}'
    if S1_APPROVE="$(json_call POST "$WALLET_BASE_URL/v1/wallet/consents/$S1_CONSENT_ID/approve" "$WALLET_ACCESS" "$S1_APPROVE_PAYLOAD")"; then
      S1_ASSERTION_JWT="$(printf '%s' "$S1_APPROVE" | jq -r '.assertionJwt // empty')"
      S1_VERIFY_PAYLOAD="$(jq -n --arg consentId "$S1_CONSENT_ID" --arg assertionJwt "$S1_ASSERTION_JWT" '{consentId:$consentId,assertionJwt:$assertionJwt}')"
      if S1_VERIFY="$(json_call POST "$FI_BASE_URL/v1/fi/verify-assertion" "$FI_ACCESS" "$S1_VERIFY_PAYLOAD")"; then
        if [[ "$(printf '%s' "$S1_VERIFY" | jq -r '.verified // false')" == "true" ]]; then
          add_result "S1 Owner Approve + Verify" "PASS" "$S1_CONSENT_ID"
        else
          add_result "S1 Owner Approve + Verify" "FAIL" "Verify returned verified=false"
        fi
      else
        add_result "S1 Owner Approve + Verify" "FAIL" "Verify failed HTTP $LAST_HTTP_STATUS"
      fi
    else
      add_result "S1 Owner Approve + Verify" "FAIL" "Owner approve failed HTTP $LAST_HTTP_STATUS"
    fi
  else
    add_result "S1 Owner Approve + Verify" "FAIL" "Consent ID missing"
  fi
else
  add_result "S1 Owner Approve + Verify" "FAIL" "Request consent failed HTTP $LAST_HTTP_STATUS"
fi

# S2 Reject + Verify Fail
S2_REQ_PAYLOAD="$(jq -n --arg uid "$UID_VALUE" '{userId:$uid,fiId:"fi-client",purpose:"loan-processing",requestedFields:["fullName","dob"],ttlSeconds:600,requiresDelegation:false}')"
if S2_REQ="$(json_call POST "$FI_BASE_URL/v1/fi/request-kyc" "$FI_ACCESS" "$S2_REQ_PAYLOAD")"; then
  S2_CONSENT_ID="$(printf '%s' "$S2_REQ" | jq -r '.consentId // empty')"
  if [[ -n "$S2_CONSENT_ID" ]]; then
    if json_call POST "$WALLET_BASE_URL/v1/wallet/consents/$S2_CONSENT_ID/reject" "$WALLET_ACCESS" '{"reason":"User declined"}' >/dev/null; then
      S2_VERIFY_BAD_PAYLOAD="$(jq -n --arg consentId "$S2_CONSENT_ID" --arg assertionJwt "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" '{consentId:$consentId,assertionJwt:$assertionJwt}')"
      if json_call POST "$FI_BASE_URL/v1/fi/verify-assertion" "$FI_ACCESS" "$S2_VERIFY_BAD_PAYLOAD" >/dev/null; then
        add_result "S2 Reject + Verify Fail" "FAIL" "UNEXPECTED_SUCCESS"
      else
        add_result "S2 Reject + Verify Fail" "PASS" "HTTP $LAST_HTTP_STATUS"
      fi
    else
      add_result "S2 Reject + Verify Fail" "FAIL" "Reject failed HTTP $LAST_HTTP_STATUS"
    fi
  else
    add_result "S2 Reject + Verify Fail" "FAIL" "Consent ID missing"
  fi
else
  add_result "S2 Reject + Verify Fail" "FAIL" "Request consent failed HTTP $LAST_HTTP_STATUS"
fi

# S3 Delegation Required
S3_USER_ID="$WALLET_ACTOR_ID"
S3_ISSUE_PAYLOAD="$(jq -n --arg uid "$S3_USER_ID" '{kyc:{fullName:"Delegation User",dob:"1990-01-01",idNumber:$uid,email:"delegation.user@example.local",phone:"+919000000007",addressLine1:"Hyderabad",pincode:"500001"},ttlSeconds:1800}')"
json_call POST "$ISSUER_BASE_URL/v1/issuer/kyc/issue" "$ISSUER_ACCESS" "$S3_ISSUE_PAYLOAD" >/dev/null || true
S3_REQ_PAYLOAD="$(jq -n --arg uid "$S3_USER_ID" '{userId:$uid,fiId:"fi-client",purpose:"insurance-claim",requestedFields:["fullName","dob","phone"],ttlSeconds:600,requiresDelegation:true}')"
if S3_REQ="$(json_call POST "$FI_BASE_URL/v1/fi/request-kyc" "$FI_ACCESS" "$S3_REQ_PAYLOAD")"; then
  S3_CONSENT_ID="$(printf '%s' "$S3_REQ" | jq -r '.consentId // empty')"
  OWNER_OUTCOME="UNEXPECTED_SUCCESS"
  if json_call POST "$WALLET_BASE_URL/v1/wallet/consents/$S3_CONSENT_ID/approve" "$WALLET_ACCESS" '{"reason":"Owner attempt"}' >/dev/null; then
    OWNER_OUTCOME="UNEXPECTED_SUCCESS"
  else
    OWNER_OUTCOME="HTTP $LAST_HTTP_STATUS"
  fi

  EXPIRY_UTC="$(perl -MPOSIX -e 'print strftime("%Y-%m-%dT%H:%M:%SZ", gmtime(time()+7*24*3600))')"
  S3_DELEG_PAYLOAD="$(jq -n --arg uid "$S3_USER_ID" --arg nominee "$NOMINEE_USER" --arg exp "$EXPIRY_UTC" '{ownerUserId:$uid,delegateUserId:$nominee,scope:"consent.approve",allowedPurposes:["insurance-claim"],allowedFields:["fullName","dob","phone"],expiresAt:$exp}')"
  if S3_DELEG="$(json_call POST "$WALLET_BASE_URL/v1/wallet/delegations" "$WALLET_ACCESS" "$S3_DELEG_PAYLOAD")"; then
    S3_DELEG_ID="$(printf '%s' "$S3_DELEG" | jq -r '.id // "missing-delegation-id"')"
    if S3_APPROVE="$(json_call POST "$WALLET_BASE_URL/v1/wallet/consents/$S3_CONSENT_ID/approve" "$NOMINEE_ACCESS" '{"reason":"Nominee approval"}')"; then
      S3_ASSERTION="$(printf '%s' "$S3_APPROVE" | jq -r '.assertionJwt // empty')"
      S3_VERIFY_PAYLOAD="$(jq -n --arg consentId "$S3_CONSENT_ID" --arg assertionJwt "$S3_ASSERTION" '{consentId:$consentId,assertionJwt:$assertionJwt}')"
      if S3_VERIFY="$(json_call POST "$FI_BASE_URL/v1/fi/verify-assertion" "$FI_ACCESS" "$S3_VERIFY_PAYLOAD")"; then
        if [[ "$OWNER_OUTCOME" != "UNEXPECTED_SUCCESS" && "$(printf '%s' "$S3_VERIFY" | jq -r '.verified // false')" == "true" ]]; then
          add_result "S3 Delegation Required" "PASS" "owner=$OWNER_OUTCOME; delegation=$S3_DELEG_ID"
        else
          add_result "S3 Delegation Required" "FAIL" "owner=$OWNER_OUTCOME; verify=$(printf '%s' "$S3_VERIFY" | jq -c '.')"
        fi
      else
        add_result "S3 Delegation Required" "FAIL" "Nominee verify failed HTTP $LAST_HTTP_STATUS"
      fi
    else
      add_result "S3 Delegation Required" "FAIL" "Nominee approve failed HTTP $LAST_HTTP_STATUS"
    fi
  else
    add_result "S3 Delegation Required" "FAIL" "Create delegation failed HTTP $LAST_HTTP_STATUS body=$(printf '%s' \"$LAST_HTTP_BODY\" | tr -d '\n' | cut -c1-140)"
  fi
else
  add_result "S3 Delegation Required" "FAIL" "Request consent failed HTTP $LAST_HTTP_STATUS"
fi

# S4 FI2 Reuse Guard
if [[ -n "$S1_CONSENT_ID" && -n "$S1_ASSERTION_JWT" ]]; then
  S4_PAYLOAD="$(jq -n --arg consentId "$S1_CONSENT_ID" --arg assertionJwt "$S1_ASSERTION_JWT" '{consentId:$consentId,assertionJwt:$assertionJwt}')"
  if json_call POST "$FI_BASE_URL/v1/fi/verify-assertion" "$FI2_ACCESS" "$S4_PAYLOAD" >/dev/null; then
    add_result "S4 FI2 Reuse Guard" "FAIL" "UNEXPECTED_SUCCESS"
  else
    add_result "S4 FI2 Reuse Guard" "PASS" "HTTP $LAST_HTTP_STATUS"
  fi
else
  add_result "S4 FI2 Reuse Guard" "FAIL" "Skipped because S1 did not produce consent/assertion"
fi

# S5 Consent Expiry
S5_REQ_PAYLOAD="$(jq -n --arg uid "$UID_VALUE" '{userId:$uid,fiId:"fi-client",purpose:"kyc-refresh",requestedFields:["fullName"],ttlSeconds:1,requiresDelegation:false}')"
if S5_REQ="$(json_call POST "$FI_BASE_URL/v1/fi/request-kyc" "$FI_ACCESS" "$S5_REQ_PAYLOAD")"; then
  S5_CONSENT_ID="$(printf '%s' "$S5_REQ" | jq -r '.consentId // empty')"
  sleep 2
  if json_call POST "$WALLET_BASE_URL/v1/wallet/consents/$S5_CONSENT_ID/approve" "$WALLET_ACCESS" '{"reason":"late approval"}' >/dev/null; then
    add_result "S5 Consent Expiry" "FAIL" "UNEXPECTED_SUCCESS"
  else
    add_result "S5 Consent Expiry" "PASS" "HTTP $LAST_HTTP_STATUS"
  fi
else
  add_result "S5 Consent Expiry" "FAIL" "Request consent failed HTTP $LAST_HTTP_STATUS"
fi

# S6 CKYCR Supersede
S6_ISSUE_PAYLOAD="$(jq -n --arg uid "$UID_VALUE" '{kyc:{fullName:"Supersede User",dob:"1990-01-01",idNumber:$uid,email:"supersede.user@example.local",phone:"+919000000099",addressLine1:"Bengaluru",pincode:"560001"},ttlSeconds:1800}')"
if json_call POST "$ISSUER_BASE_URL/v1/issuer/kyc/issue" "$ISSUER_ACCESS" "$S6_ISSUE_PAYLOAD" >/dev/null; then
  if json_call POST "$CKYC_BASE_URL/v1/ckyc/simulate-update/$UID_VALUE" "" "" >/dev/null; then
    if S6_SYNC="$(json_call POST "$CKYC_BASE_URL/v1/ckyc/sync/$UID_VALUE" "$ISSUER_ACCESS" "")"; then
      S6_CHANGED="$(printf '%s' "$S6_SYNC" | jq -r '.changed // false')"
      S6_OLD_STATUS="$(printf '%s' "$S6_SYNC" | jq -r '.oldStatus // empty')"
      S6_NEW_STATUS="$(printf '%s' "$S6_SYNC" | jq -r '.newStatus // empty')"
      S6_OLD_TOKEN="$(printf '%s' "$S6_SYNC" | jq -r '.oldTokenId // "n/a"')"
      S6_NEW_TOKEN="$(printf '%s' "$S6_SYNC" | jq -r '.newTokenId // "n/a"')"
      if [[ "$S6_CHANGED" == "true" && "$S6_OLD_STATUS" == "SUPERSEDED" && "$S6_NEW_STATUS" == "ACTIVE" ]]; then
        add_result "S6 CKYCR Supersede" "PASS" "$S6_OLD_TOKEN->$S6_NEW_TOKEN"
      else
        add_result "S6 CKYCR Supersede" "FAIL" "$(printf '%s' "$S6_SYNC" | jq -c '.')"
      fi
    else
      add_result "S6 CKYCR Supersede" "FAIL" "CKYCR sync failed HTTP $LAST_HTTP_STATUS"
    fi
  else
    add_result "S6 CKYCR Supersede" "FAIL" "Simulate update failed HTTP $LAST_HTTP_STATUS"
  fi
else
  add_result "S6 CKYCR Supersede" "FAIL" "Issue token for supersede failed HTTP $LAST_HTTP_STATUS"
fi

# S7 Periodic Review
AS_OF="$(date -u '+%Y-%m-%d')"
if json_call GET "$REVIEW_BASE_URL/v1/review/due?asOf=$AS_OF" "" "" >/dev/null; then
  S7_RUN_PAYLOAD="$(jq -n --arg asOf "$AS_OF" '{actor:"e2e-check",asOf:$asOf}')"
  if S7_RUN="$(json_call POST "$REVIEW_BASE_URL/v1/review/run-once" "" "$S7_RUN_PAYLOAD")"; then
    S7_DUE="$(printf '%s' "$S7_RUN" | jq -r '.totalDue // -1')"
    S7_SYNCED="$(printf '%s' "$S7_RUN" | jq -r '.synced // -1')"
    S7_FAILED="$(printf '%s' "$S7_RUN" | jq -r '.failed // -1')"
    if [[ "$S7_DUE" =~ ^[0-9]+$ && "$S7_SYNCED" =~ ^[0-9]+$ && "$S7_FAILED" =~ ^[0-9]+$ ]]; then
      add_result "S7 Periodic Review" "PASS" "due=$S7_DUE, synced=$S7_SYNCED, failed=$S7_FAILED"
    else
      add_result "S7 Periodic Review" "FAIL" "Invalid response $(printf '%s' "$S7_RUN" | jq -c '.')"
    fi
  else
    add_result "S7 Periodic Review" "FAIL" "Run once failed HTTP $LAST_HTTP_STATUS"
  fi
else
  add_result "S7 Periodic Review" "FAIL" "Due list failed HTTP $LAST_HTTP_STATUS"
fi

# S8 No Active Token Guard
S8_PAYLOAD="$(jq -n '{userId:"USER-NO-TOKEN-999",fiId:"fi-client",purpose:"account-opening",requestedFields:["fullName"],ttlSeconds:300,requiresDelegation:false}')"
if json_call POST "$FI_BASE_URL/v1/fi/request-kyc" "$FI_ACCESS" "$S8_PAYLOAD" >/dev/null; then
  add_result "S8 No Active Token Guard" "FAIL" "UNEXPECTED_SUCCESS"
else
  if [[ "$LAST_HTTP_BODY" == *"No ACTIVE token found for user"* ]]; then
    add_result "S8 No Active Token Guard" "PASS" "HTTP $LAST_HTTP_STATUS"
  else
    add_result "S8 No Active Token Guard" "FAIL" "HTTP $LAST_HTTP_STATUS body=$(printf '%s' "$LAST_HTTP_BODY" | tr -d '\n' | cut -c1-160)"
  fi
fi

print_results

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
