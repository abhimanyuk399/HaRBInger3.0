# Local K8s (kind) Runbook

These are exact commands to run `bharat-kyc-t` on kind and verify core portal flows (`/wallet`, `/fi`, `/command`).

## 1) Create kind cluster
```bash
kind create cluster --name bharat-kyc
kubectl cluster-info --context kind-bharat-kyc
```

## 2) Install ingress-nginx
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=300s
```

## 3) Build local images
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

## 4) Load images into kind
```bash
kind load docker-image bharat/issuer-service:local --name bharat-kyc
kind load docker-image bharat/registry-service:local --name bharat-kyc
kind load docker-image bharat/consent-manager:local --name bharat-kyc
kind load docker-image bharat/wallet-service:local --name bharat-kyc
kind load docker-image bharat/fi-service:local --name bharat-kyc
kind load docker-image bharat/ckyc-adapter:local --name bharat-kyc
kind load docker-image bharat/review-scheduler:local --name bharat-kyc
kind load docker-image bharat/web-ui:local --name bharat-kyc
```

## 5) Generate local Helm secrets override
```bash
node <<'NODE'
const { generateKeyPairSync, randomBytes } = require('crypto');
const { writeFileSync } = require('fs');

const toEscapedPem = () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, '\\n');
};

const out = `secrets:
  issuer-service:
    create: true
    stringData:
      JWT_PRIVATE_KEY: "${toEscapedPem()}"
      VAULT_ENCRYPTION_KEY_BASE64: "${randomBytes(32).toString('base64')}"
      ISSUER_ADMIN_CLIENT_SECRET: "issuer-admin-secret"
  consent-manager:
    create: true
    stringData:
      CONSENT_SIGNING_PRIVATE_KEY: "${toEscapedPem()}"
      CONSENT_SERVICE_CLIENT_SECRET: "issuer-admin-secret"
  review-scheduler:
    create: true
    stringData:
      REVIEW_SERVICE_CLIENT_SECRET: "issuer-admin-secret"
`;

writeFileSync('/tmp/bharat-kyc-secrets.local.yaml', out);
NODE
```

## 6) Install chart with local values
```bash
helm upgrade --install bharat-kyc-t deploy/helm/bharat-kyc-t \
  -f deploy/helm/bharat-kyc-t/values-local.yaml \
  -f /tmp/bharat-kyc-secrets.local.yaml \
  --wait --timeout 10m
```

## 7) Run Prisma migration in-cluster
```bash
kubectl run db-migrate --rm -i --restart=Never \
  --image=bharat/issuer-service:local \
  --env="DATABASE_URL=postgresql://bharat:bharat@postgres:5432/bharat?schema=public" \
  --command -- sh -lc 'npm run db:push -w packages/db'
```

## 8) Port-forward ingress (Terminal A)
```bash
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8081:80
```

## 9) Port-forward Keycloak for browser login (Terminal B)
```bash
kubectl port-forward svc/keycloak 8080:8080
```

## 10) Add hosts entry
```bash
echo "127.0.0.1 bharat-kyc.local" | sudo tee -a /etc/hosts
```

## 11) Verify portal routes
1. Open `http://bharat-kyc.local:8081/login`.
2. Login with Keycloak:
   - username: `wallet-owner-1`
   - password: `wallet-owner-1-pass`
3. Verify portals load:
   - `http://bharat-kyc.local:8081/wallet/login`
   - `http://bharat-kyc.local:8081/fi/login`
   - `http://bharat-kyc.local:8081/command`

Optional CLI readiness checks:
```bash
curl -fsS http://localhost:8080/realms/bharat-kyc-dev/.well-known/openid-configuration >/dev/null
curl -fsS -H 'Host: bharat-kyc.local' http://localhost:8081/api/issuer/v1/health?probe=readiness
curl -fsS -H 'Host: bharat-kyc.local' http://localhost:8081/api/fi/v1/health?probe=readiness
```

## 12) Cleanup
```bash
helm uninstall bharat-kyc-t
kind delete cluster --name bharat-kyc
```
