/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API base URL for external integrations */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
