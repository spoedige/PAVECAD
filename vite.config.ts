import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';
import { VitePWA } from 'vite-plugin-pwa';

/** Versão do app no build: hash do commit (Vercel ou git local) e data. Aparece em Ajustes, no diagnóstico. */
const commit = (() => {
  const v = process.env.VERCEL_GIT_COMMIT_SHA;
  if (v) return v.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
})();

const TILES = /^https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com|api\.maptiler\.com)\//;

export default defineConfig({
  define: { __APP_COMMIT__: JSON.stringify(commit), __APP_DATA__: JSON.stringify(new Date().toISOString()) },
  test: { include: ['testes/**/*.test.ts'], testTimeout: 60000 },
  plugins: process.env.VITEST ? [] : [
    VitePWA({
      registerType: 'autoUpdate', // o service worker novo assume sozinho e a página recarrega: no modo 'prompt' a versão antiga ficava em cache até alguém tocar em "Atualizar"
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PaveCAD · Mapa de Soluções de Restauração',
        short_name: 'PaveCAD',
        description: 'Mapa de soluções de restauração a partir de planilhas de unifilar. Funciona sem internet.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f5f5f7',
        theme_color: '#007aff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // O app inteiro (HTML, JS, CSS, worker, ícones) fica no cache para abrir sem rede.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Tiles já vistos continuam disponíveis offline. O limite em MB (Ajustes > Campo e offline) poda os mais antigos
            // pelo app (app/tilesCache); maxEntries é só o teto de segurança. O "Preparar para campo" pede os tiles pelo
            // caminho normal de requisição, com poucas requisições por segundo e teto menor no OpenStreetMap.
            urlPattern: TILES,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mapa-tiles',
              expiration: { maxEntries: 40000, maxAgeSeconds: 60 * 60 * 24 * 180, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fontes-css' } },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'fontes', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
});
