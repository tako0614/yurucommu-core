/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ホスティングモードかどうか */
  readonly VITE_HOSTED_MODE?: string;
  /** API Base URL (ホスティングモード時) */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
