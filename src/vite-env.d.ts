/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave do MapTiler. Defina no ambiente de build (Vercel) ou em .env.local. Nunca no repositório. */
  readonly VITE_MAPTILER_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
