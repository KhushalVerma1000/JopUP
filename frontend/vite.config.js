import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn/ui's generated components import via '@/components/...' —
    // this alias is what makes that resolve to src/. fileURLToPath (not
    // new URL(...).pathname) is required for this to work correctly on
    // Windows: .pathname leaves a leading slash before the drive letter
    // (e.g. "/D:/...") and leaves spaces percent-encoded ("job%20project"),
    // both of which break path resolution. fileURLToPath handles both
    // correctly cross-platform.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Forwards to the backend published by docker-compose.yml on
      // localhost:3000. This means the browser only ever talks to the Vite
      // dev server's own origin — Vite proxies server-side to the backend —
      // so there's no CORS issue in dev, and no CORS middleware is needed
      // on the backend for this. If the built frontend is later served
      // from a different origin than the API in production, the backend
      // WILL need CORS added at that point (it currently has none).
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
