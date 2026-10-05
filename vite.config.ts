import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Permite que celulares na mesma rede Wi-Fi abram o app hospedado neste PC.
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Servia - Gestão para restaurantes',
        short_name: 'Servia',
        description: 'Gestão e atendimento para restaurantes',
        theme_color: '#08100e',
        background_color: '#08100e',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
})
