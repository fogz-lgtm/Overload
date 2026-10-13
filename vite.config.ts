import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH lets the GitHub Pages workflow serve from /<repo>/.
const base = process.env.BASE_PATH ?? '/';

// Stamped into the app (Settings → About) so you can tell which deploy is installed.
const buildId = process.env.GITHUB_SHA?.slice(0, 7) ?? `dev-${new Date().toISOString().slice(0, 16)}`;

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Overload — Strength Coach',
        short_name: 'Overload',
        description: 'Open-source, local-first strength coach with adaptive workouts and progressive overload.',
        theme_color: '#0e0f11',
        background_color: '#0e0f11',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
