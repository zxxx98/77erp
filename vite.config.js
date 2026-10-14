import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['favicon.svg', 'icons/*.png'],
    manifest: {
      id: '/', name: '77 ERP · 进销存', short_name: '77 ERP', lang: 'zh-CN', description: '商品管理、扫码入出库及库存管理',
      start_url: '/', scope: '/', display: 'standalone', theme_color: '#2563eb', background_color: '#f7f8fa',
      icons: [
        { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: true,
      runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
    },
    devOptions: { enabled: false },
  })],
  build: { rollupOptions: { output: { manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-dom/client'] } } } },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:3001" } },
});
