/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KEYCLOAK_URL?: string;
  readonly VITE_KEYCLOAK_REALM?: string;
  readonly VITE_KEYCLOAK_CLIENT_ID?: string;
  readonly VITE_FI_KEYCLOAK_CLIENT_ID?: string;
  readonly VITE_FI_CLIENT_ID?: string;
  readonly VITE_FI2_CLIENT_ID?: string;
  readonly VITE_CONSOLE_DEBUG_LOGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
