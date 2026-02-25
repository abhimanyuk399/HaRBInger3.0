# bharat-kyc-t

Tokenized KYC reference implementation with issuer, registry, consent, wallet, FI verification, CKYC mock updates, and enterprise web portals.

## Services
- `issuer-service` - issues ES256 JWTs + JWKS; protected by OIDC scopes `token.issue` and `token.revoke`.
- `registry-service` - stores token metadata + hashes only (no raw PII).
- `consent-manager` - captures consent with aud/purpose binding.
- `wallet-service` - stores token references; protected by OIDC scopes `consent.read`, `consent.approve`, `token.read`.
- `fi-service` - verifies tokens and registry status; protected by OIDC scopes `kyc.request`, `kyc.verify`.
- `ckyc-adapter` - mock CKYC update adapter.
- `review-scheduler` - config-driven periodic review (`HIGH=2y`, `MEDIUM=8y`, `LOW=10y` by default), due listing, run-once workflow + optional CronJob.
- `web-ui` - React + Vite + Tailwind + shadcn/ui portals with Keycloak login.

## Quickstart
1. Start stack:
   ```bash
   docker compose up --build
   ```
2. Open `http://localhost:5173/login`.
3. Sign in and continue to one of the portals:
   - Wallet Portal: `/wallet/login`
   - FI Portal: `/fi/login`
   - Command Centre: `/command`

Default local credentials:
- Keycloak URL: `http://localhost:8080`
- Realm: `bharat-kyc-dev`
- Wallet owner: `wallet-owner-1` / `wallet-owner-1-pass`
- Wallet nominee: `wallet-nominee` / `wallet-nominee-pass`

## What's Implemented (Checklist)
- Token Issuance
- Consent Request
- Wallet Approval
- FI Verify
- CKYCR Supersede
- Revoke
- Post-Revoke Verify Fail (`TOKEN_NOT_ACTIVE`)
- Delegation (Nominee)
- Periodic Review Run
- Audit Chain (hash-linked registry audit)

## Keycloak Dev Realm
- Realm import file: `deploy/keycloak/dev-realm.json`
- Realm name: `bharat-kyc-dev`
- Clients:
  - `wallet-client` (auth code + PKCE)
  - `fi-client` (client credentials)
  - `fi-client-2` (client credentials, FI2 reuse branch)
  - `issuer-admin` (client credentials)
- Dev wallet login:
  - username: `wallet-owner-1`
  - password: `wallet-owner-1-pass`
- Dev nominee login:
  - username: `wallet-nominee`
  - password: `wallet-nominee-pass`
- Redirect URIs configured for `wallet-client`:
  - `http://localhost:5173/*`
- Portal auth note:
  - `/wallet/*`, `/fi/*`, and `/command/*` use Keycloak role-based access with the same realm.
- Deterministic local dev:
  - `docker compose` runs `keycloak-bootstrap` on startup to upsert wallet owner + nominee users, reset their passwords, and enforce wallet client redirect URIs even when realm import is skipped because the realm already exists.

## Local Dev
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create local secrets file for docker compose:
   ```bash
   cp .env.example .env
   ```
   - Fill all placeholders in `.env`.
   - `JWT_PRIVATE_KEY` and `CONSENT_SIGNING_PRIVATE_KEY` must be single-line values with literal `\n` separators.
   - `CONSENT_SERVICE_CLIENT_SECRET` and `REVIEW_SERVICE_CLIENT_SECRET` must match the Keycloak `issuer-admin` client secret.
   - `KEYCLOAK_FI_CLIENT_SECRET` must match the Keycloak `fi-client` client secret.
   - `KEYCLOAK_FI2_CLIENT_SECRET` must match the Keycloak `fi-client-2` client secret.
   - `KEYCLOAK_NOMINEE_USER`/`KEYCLOAK_NOMINEE_PASSWORD` are used by bootstrap for nominee approval flows in Wallet Portal.
   - `CONSENT_TTL_SECONDS` controls consent expiry window (default `300` = 5 minutes).
   - Optional periodicity overrides for review scheduler: `REVIEW_PERIOD_HIGH_YEARS`, `REVIEW_PERIOD_MEDIUM_YEARS`, `REVIEW_PERIOD_LOW_YEARS`.
3. Start the stack:
   ```bash
   docker compose up --build
   ```
   - Optional clean reset if you want a brand-new Keycloak/Postgres/Redis state:
     ```bash
     docker compose down -v
     ```
   - If secrets are missing, compose interpolation and service startup fail fast with explicit messages.
4. Run end-to-end scenario checks:
   - Windows PowerShell:
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\tmp-e2e.ps1
     ```
   - macOS/Linux:
     ```bash
     chmod +x ./tmp-e2e.sh
     ./tmp-e2e.sh
     ```
   - `tmp-e2e.sh` prerequisites: `curl`, `jq`, `openssl`, `perl`.
   - Browser UI smoke (route/login/portal checks):
     - Windows PowerShell:
       ```powershell
       powershell -ExecutionPolicy Bypass -File .\scripts\ui-e2e-smoke.ps1
       ```
     - macOS/Linux:
       ```bash
     chmod +x ./scripts/ui-e2e-smoke.sh
     ./scripts/ui-e2e-smoke.sh
     ```
    - prerequisites: `curl`.
   - Security hardening smoke:
     - Windows PowerShell:
       ```powershell
       powershell -ExecutionPolicy Bypass -File .\scripts\security-hardening-smoke.ps1
       ```
     - macOS/Linux:
       ```bash
       chmod +x ./scripts/security-hardening-smoke.sh
       ./scripts/security-hardening-smoke.sh
       ```
     - prerequisites: `curl`, `jq`, `perl`.
   - Performance smoke:
     - Windows PowerShell:
       ```powershell
       powershell -ExecutionPolicy Bypass -File .\scripts\perf-smoke.ps1
       ```
     - macOS/Linux:
       ```bash
       chmod +x ./scripts/perf-smoke.sh
       ./scripts/perf-smoke.sh
       ```
     - prerequisites: `curl`, `awk`, `sort`, `xargs`.
5. Open endpoints:
   - Unified login: `http://localhost:5173/login`
   - Wallet Portal: `http://localhost:5173/wallet/login`
   - FI Portal: `http://localhost:5173/fi/login`
   - Command Centre: `http://localhost:5173/command`
   - Keycloak: `http://localhost:8080`
   - Keycloak realm metadata: `http://localhost:8080/realms/bharat-kyc-dev/.well-known/openid-configuration`
6. Scenario execution flow (production-style):
   1) Command Centre: issue token for wallet user.
   2) FI Portal: create consent request.
   3) Wallet Portal: approve/reject (owner or nominee).
   4) FI Portal: verify assertion and inspect evidence.
   5) Command Centre: audit timeline and service health.

### Web UI `.env` (for non-compose runs)
If you run `apps/web-ui` directly (not via docker compose), create `apps/web-ui/.env` with:
```bash
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=bharat-kyc-dev
VITE_KEYCLOAK_CLIENT_ID=wallet-client
VITE_FI_KEYCLOAK_CLIENT_ID=fi-browser-client
VITE_FI_CLIENT_ID=fi-client
VITE_FI2_CLIENT_ID=fi-client-2
```
`docker compose` already injects these values for `web-ui`.

Optional consent configuration for `consent-manager`:
```bash
CONSENT_TTL_SECONDS=300
```

## Access Token Examples
- `fi-client` token (client credentials):
  ```bash
  curl -s -X POST 'http://localhost:8080/realms/bharat-kyc-dev/protocol/openid-connect/token' \
    -H 'content-type: application/x-www-form-urlencoded' \
    -d 'grant_type=client_credentials' \
    -d 'client_id=fi-client' \
    -d 'client_secret=<fi-client-secret>'
  ```
- `fi-client-2` token (client credentials):
  ```bash
  curl -s -X POST 'http://localhost:8080/realms/bharat-kyc-dev/protocol/openid-connect/token' \
    -H 'content-type: application/x-www-form-urlencoded' \
    -d 'grant_type=client_credentials' \
    -d 'client_id=fi-client-2' \
    -d 'client_secret=<fi-client-2-secret>'
  ```
- `issuer-admin` token (client credentials):
  ```bash
  curl -s -X POST 'http://localhost:8080/realms/bharat-kyc-dev/protocol/openid-connect/token' \
    -H 'content-type: application/x-www-form-urlencoded' \
    -d 'grant_type=client_credentials' \
    -d 'client_id=issuer-admin' \
    -d 'client_secret=<issuer-admin-client-secret>'
  ```

## Local K8s (kind)
Use `LOCAL_K8S.md` for an exact, copy/paste runbook (kind + ingress-nginx + Helm + `/command` Scenario A verification).

1. Install Helm and ingress-nginx in kind.
2. Build local images:
   ```bash
   docker build -f docker/Dockerfile.service -t bharat/issuer-service:local .
   docker build -f docker/Dockerfile.service -t bharat/registry-service:local .
   docker build -f docker/Dockerfile.service -t bharat/consent-manager:local .
   docker build -f docker/Dockerfile.service -t bharat/wallet-service:local .
   docker build -f docker/Dockerfile.service -t bharat/fi-service:local .
   docker build -f docker/Dockerfile.service -t bharat/ckyc-adapter:local .
   docker build -f docker/Dockerfile.service -t bharat/review-scheduler:local .
   docker build -f docker/Dockerfile.web -t bharat/web-ui:local .
   ```
3. Load images into kind:
   ```bash
   kind load docker-image bharat/issuer-service:local
   kind load docker-image bharat/registry-service:local
   kind load docker-image bharat/consent-manager:local
   kind load docker-image bharat/wallet-service:local
   kind load docker-image bharat/fi-service:local
   kind load docker-image bharat/ckyc-adapter:local
   kind load docker-image bharat/review-scheduler:local
   kind load docker-image bharat/web-ui:local
   ```
4. Create an uncommitted Helm secrets override file (uses chart `Secret` templates):
   ```bash
   cat >/tmp/bharat-kyc-secrets.local.yaml <<'EOF'
   secrets:
     issuer-service:
       create: true
       stringData:
         JWT_PRIVATE_KEY: "<issuer-es256-private-key-pem>"
         VAULT_ENCRYPTION_KEY_BASE64: "<base64-32-byte-key>"
         ISSUER_ADMIN_CLIENT_SECRET: "<issuer-admin-client-secret>"
     consent-manager:
       create: true
       stringData:
         CONSENT_SIGNING_PRIVATE_KEY: "<consent-es256-private-key-pem>"
         CONSENT_SERVICE_CLIENT_SECRET: "<consent-service-client-secret>"
   review-scheduler:
     create: true
     stringData:
       REVIEW_SERVICE_CLIENT_SECRET: "<review-service-client-secret>"
   EOF
   ```
5. Render and apply:
   ```bash
   helm template bharat-kyc-t deploy/helm/bharat-kyc-t \
     -f deploy/helm/bharat-kyc-t/values-local.yaml \
     -f /tmp/bharat-kyc-secrets.local.yaml | kubectl apply -f -
   ```
6. Install or upgrade release directly (alternative to template+apply):
   ```bash
   helm upgrade --install bharat-kyc-t deploy/helm/bharat-kyc-t \
     -f deploy/helm/bharat-kyc-t/values-local.yaml \
     -f /tmp/bharat-kyc-secrets.local.yaml
   ```
7. Add local host entry for ingress:
   ```bash
   echo "127.0.0.1 bharat-kyc.local" | sudo tee -a /etc/hosts
   ```
8. Access app:
   - `http://bharat-kyc.local/`
   - APIs via:
     - `/api/issuer`
     - `/api/fi`
     - `/api/consent`
     - `/api/registry`
     - `/api/wallet`
     - `/api/ckyc`
     - `/api/review`
9. Port-forward fallback if needed:
   ```bash
   kubectl port-forward svc/web-ui 5173:5173
   ```

## GKE Deploy
1. Create cluster and kube context:
   ```bash
   export PROJECT_ID="<gcp-project-id>"
   export REGION="asia-south1"
   export CLUSTER_NAME="bharat-kyc"

   gcloud config set project "${PROJECT_ID}"
   gcloud services enable container.googleapis.com sqladmin.googleapis.com redis.googleapis.com

   gcloud container clusters create "${CLUSTER_NAME}" \
     --region "${REGION}" \
     --release-channel regular \
     --num-nodes 3 \
     --workload-pool="${PROJECT_ID}.svc.id.goog"

   gcloud container clusters get-credentials "${CLUSTER_NAME}" \
     --region "${REGION}" \
     --project "${PROJECT_ID}"
   ```
2. Install ingress-nginx and cert-manager (if your cluster does not already have them):
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm repo add jetstack https://charts.jetstack.io
   helm repo update

   helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
     --namespace ingress-nginx --create-namespace

   helm upgrade --install cert-manager jetstack/cert-manager \
     --namespace cert-manager --create-namespace \
     --set crds.enabled=true
   ```
3. Update `deploy/helm/bharat-kyc-t/values-gke.yaml`:
   - `serviceAccount.annotations.iam.gke.io/gcp-service-account` -> your GSA email.
   - `global.cloudSqlAuthProxy.instanceConnectionName` -> `PROJECT:REGION:INSTANCE`.
   - `global.database.name/user/password` -> target DB credentials.
   - `global.redis.url` (or `global.redis.host`/`port`) -> Memorystore endpoint.
   - `global.keycloak.*` -> your Keycloak issuer/token/JWKS URLs.
   - `services.*.image` -> your pushed image repositories/tags.
   - `ingress.host` + TLS fields.
4. Grant Cloud SQL access to GSA and bind Workload Identity (namespace `default`, KSA `bharat-kyc-ksa`):
   ```bash
   export GSA_NAME="bharat-kyc-workload"
   export GSA_EMAIL="${GSA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

   gcloud iam service-accounts create "${GSA_NAME}"
   gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
     --member="serviceAccount:${GSA_EMAIL}" \
     --role="roles/cloudsql.client"

   gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
     --role="roles/iam.workloadIdentityUser" \
     --member="serviceAccount:${PROJECT_ID}.svc.id.goog[default/bharat-kyc-ksa]"
   ```
5. Create a secure, uncommitted Helm secrets override file (or use ExternalSecrets/Secret Manager and keep `create: false`):
   ```bash
   cat >/tmp/bharat-kyc-secrets.gke.yaml <<'EOF'
   secrets:
     issuer-service:
       create: true
       stringData:
         JWT_PRIVATE_KEY: "<issuer-es256-private-key-pem>"
         VAULT_ENCRYPTION_KEY_BASE64: "<base64-32-byte-key>"
         ISSUER_ADMIN_CLIENT_SECRET: "<issuer-admin-client-secret>"
     consent-manager:
       create: true
       stringData:
         CONSENT_SIGNING_PRIVATE_KEY: "<consent-es256-private-key-pem>"
         CONSENT_SERVICE_CLIENT_SECRET: "<consent-service-client-secret>"
   review-scheduler:
     create: true
     stringData:
       REVIEW_SERVICE_CLIENT_SECRET: "<review-service-client-secret>"
   EOF
   ```
6. Render manifests:
   ```bash
   helm template bharat-kyc-t deploy/helm/bharat-kyc-t \
     -f deploy/helm/bharat-kyc-t/values-gke.yaml \
     -f /tmp/bharat-kyc-secrets.gke.yaml | kubectl apply -f -
   ```
7. Install/upgrade release:
   ```bash
   helm upgrade --install bharat-kyc-t deploy/helm/bharat-kyc-t \
     --namespace default \
     -f deploy/helm/bharat-kyc-t/values-gke.yaml \
     -f /tmp/bharat-kyc-secrets.gke.yaml
   ```

## Tests
- Unit tests:
  ```bash
  npm test
  ```

## GitHub Actions
- Workflow file: `.github/workflows/ci.yml`
- Jobs:
  - `ci`: runs `npm run lint`, `npm test`, starts compose services, and runs readiness/Helm validation checks.
- Exact Helm validation commands used in CI:
  ```bash
  helm lint deploy/helm/bharat-kyc-t -f deploy/helm/bharat-kyc-t/values-local.yaml
  helm template bharat-kyc-t deploy/helm/bharat-kyc-t -f deploy/helm/bharat-kyc-t/values-local.yaml >/tmp/local-render.yaml
  helm template bharat-kyc-t deploy/helm/bharat-kyc-t -f deploy/helm/bharat-kyc-t/values-gke.yaml >/tmp/gke-render.yaml
  ```

## Notes
- All services implement `/v1/health` with `probe=liveness|readiness`.
- Services that require secrets (`issuer-service`, `consent-manager`, `review-scheduler`) fail fast on startup with explicit missing-secret errors.
- Issuer JWKS endpoint is `/.well-known/jwks.json`; consumers should use `JWKS_URL=http://issuer-service:3001/.well-known/jwks.json`.
- OpenAPI specs live alongside each service as `openapi.yaml`.
- Registry stores only hashed PII; raw PII never persists.
- Logs are structured JSON with sensitive fields redacted.
- Web UI calls backend APIs via relative ingress-friendly routes: `/api/{issuer|registry|consent|wallet|fi}/...`.
- Helm umbrella chart uses one Ingress with routes:
  - `/` -> `web-ui`
  - `/api/issuer` -> `issuer-service`
  - `/api/fi` -> `fi-service`
  - `/api/consent` -> `consent-manager`
  - `/api/registry` -> `registry-service`
  - `/api/wallet` -> `wallet-service`
  - `/api/ckyc` -> `ckyc-adapter`
  - `/api/review` -> `review-scheduler`
