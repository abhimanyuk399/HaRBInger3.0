import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const issuerTarget = process.env.API_PROXY_ISSUER ?? 'http://localhost:3001';
const registryTarget = process.env.API_PROXY_REGISTRY ?? 'http://localhost:3002';
const consentTarget = process.env.API_PROXY_CONSENT ?? 'http://localhost:3003';
const walletTarget = process.env.API_PROXY_WALLET ?? 'http://localhost:3004';
const fiTarget = process.env.API_PROXY_FI ?? 'http://localhost:3005';
const ckycTarget = process.env.API_PROXY_CKYC ?? 'http://localhost:3006';
const reviewTarget = process.env.API_PROXY_REVIEW ?? 'http://localhost:3007';
const keycloakTarget = process.env.API_PROXY_KEYCLOAK ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/issuer': {
        target: issuerTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/issuer/, ''),
      },
      '/api/registry': {
        target: registryTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/registry/, ''),
      },
      '/api/consent': {
        target: consentTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/consent/, ''),
      },
      '/api/wallet': {
        target: walletTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wallet/, ''),
      },
      '/api/fi': {
        target: fiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fi/, ''),
      },
      '/api/ckyc': {
        target: ckycTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ckyc/, ''),
      },
      '/api/review': {
        target: reviewTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/review/, ''),
      },
      '/api/keycloak': {
        target: keycloakTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/keycloak/, ''),
      },
    },
  },
});
