# HaRBInger Tokenised KYC Strict Gap Audit (a-j) - v9

## Scope
Audit mapped against **actual endpoints** and **current UI screens** in the codebase after v9 patching.

## Endpoint inventory (relevant)
- **Issuer**: issue/revoke/supersede token (`apps/issuer-service/src/index.ts`)
- **Registry**: token lookup/audit/status updates (`apps/registry-service/src/index.ts`)
- **Consent**: create/approve/reject/revoke/renew, bindings (`apps/consent-manager/src/index.ts`)
- **Wallet**: token renew, review status, nominees, delegations, consent approve/reject/revoke (`apps/wallet-service/src/index.ts`)
- **FI**: request KYC, onboard user, token coverage, renew consent, revoke consent (v9), verify assertion (`apps/fi-service/src/index.ts`)
- **CKYC Adapter**: CKYC profile/sync + Aadhaar/DigiLocker mock adapters + privacy policy endpoints (`apps/ckyc-adapter/src/index.ts`)
- **Review Scheduler**: periodic KYC/lifecycle jobs + demo lifecycle simulation (`apps/review-scheduler/src/index.ts`)

## UI screens (relevant)
- Wallet: Home, Inbox, History, Nominees, Delegations, Timeline
- FI: Home, Create Consent, Queue, Timeline
- Command Centre: Home, Operations, Registry, Scenario, Integrations, Audit (Verifier removed/redirected)

## a-j Checklist

### a. Token-based user-held KYC model with digitally signed credentials shared across institutions
- **Endpoints**: ✅ issuer issue + consent manager + FI verify + FI2 reuse paths exist
- **UI**: ✅ Wallet/FI flows expose token/consent/verify; Command shows visibility
- **Status**: **Implemented (demo-grade)**

### b. Tamper-proof, machine-readable identity tokens, trusted issuer, reusable onboarding
- **Endpoints**: ✅ issuer JWKS, signed JWT issuance, registry status, FI assertion verification
- **UI**: ✅ FI verification evidence + wallet token visibility
- **Status**: **Implemented (demo-grade)**

### c. User control, explicit consent-driven sharing, auditable
- **Endpoints**: ✅ consent create/approve/reject/revoke; wallet revoke; audit events
- **UI**: ✅ Wallet inbox/history + FI queue/timeline + Command audit
- **Status**: **Implemented**

### d. Tamper-resistant, traceable, selective disclosure
- **Endpoints**: ✅ requestedFields on consent + assertion verification checks scope/nonce/JTI + registry lookup
- **UI**: ✅ FI Create Consent field selection; FI details show requested fields; audit evidence panels
- **Status**: **Implemented (selective disclosure demo)**

### e. Interoperability via standards/APIs/common exchange protocols
- **Endpoints**: ✅ service APIs across issuer/registry/consent/fi/wallet + internal bindings; CKYC adapter APIs
- **UI**: ✅ Integrations page + FI/Wallet operational consumption flows
- **Status**: **Implemented (mock/integration-stub for external systems)**

### f. Privacy guideline adherence
- **Endpoints**: ✅ privacy policy adapter endpoints (`/v1/adapters/privacy/policy`) + consent/field scoping
- **UI**: ⚠️ privacy controls mostly implied through consent field selection; no dedicated privacy settings screen
- **Status**: **Partially implemented (backend + consent minimization; limited UI surfacing)**
- **Patch suggestion (next)**: add Privacy Policy card in FI/Wallet Integrations/Settings and show policy version + masking rules

### g. Real-time KYC revocation, renewal, audit tracking
- **Endpoints**: ✅ token revoke/supersede, wallet token renew, consent renew/revoke, FI verify/audit, lifecycle jobs
- **UI**: ✅ Wallet history + FI queue/timeline + Command audit/registry; **FI revoke consent added in v9**
- **Status**: **Implemented**

### h. Aadhaar, DigiLocker, CKYCR interoperability across institutions via common APIs
- **Endpoints**: ✅ CKYC profile/sync, Aadhaar eKYC mock, DigiLocker docs mock, privacy policy adapter
- **UI**: ✅ Command Integrations visibility; operational pathways reference periodic CKYC sync/review
- **Status**: **Implemented (mock/stub integrations)**

### i. Secure delegation to legal heirs/guardians/nominees
- **Endpoints**: ✅ nominees create/enable/disable, delegations create/revoke, wallet approve/reject with delegation logic
- **UI**: ✅ Wallet Nominees + Delegations + Inbox delegated handling; FI queue shows approval policy/delegation context
- **Status**: **Implemented**

### j. Address updation, periodic KYC updation, leverage for insurance/mutual funds
- **Endpoints**: ✅ CKYC sync/simulate update, review scheduler due/run/lifecycle, wallet review status/reconsent endpoint
- **UI**: ✅ Wallet notifications/review signal + FI periodic review purpose option + timeline/audit visibility
- **Status**: **Implemented (demo-grade)**

## Remaining demo gaps (strict)
1. **Privacy UI (f) is the main visible gap** — backend support exists but no first-class portal screen.
2. **External integration endpoints are mocks/stubs** (appropriate for hackathon demo but should be labeled).
3. **Command Centre still contains some scenario controls** in legacy pages (if strict bird’s-eye-only is required, disable action buttons page-by-page).

