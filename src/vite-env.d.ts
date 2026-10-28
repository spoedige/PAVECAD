/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Chave do MapTiler. Defina no ambiente de build (Vercel) ou em .env.local. Nunca no repositório. */
  readonly VITE_MAPTILER_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Definidos no build (vite.config.ts). */
declare const __APP_COMMIT__: string;
declare const __APP_DATA__: string;
