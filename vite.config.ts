import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const TILES = /^https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com|api\.maptiler\.com)\//;

export default defineConfig({
  test: { include: ['testes/**/*.test.ts'], testTimeout: 60000 },
  plugins: process.env.VITEST ? [] : [
    VitePWA({
      registerType: 'autoUpdate',
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
            // Tiles já vistos continuam disponíveis offline. Não há download em massa: as políticas
            // do OpenStreetMap e da Esri proíbem, e o MapTiler depende do plano.
            urlPattern: TILES,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mapa-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
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
