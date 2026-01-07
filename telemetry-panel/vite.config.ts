import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 6000,
    strictPort: true, // Fail if port 6000 is taken
    allowedHosts: ['telemetry.pollbot.win', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/supabase/realtime': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
        ws: true,
      },
      '/supabase': {
        target: 'http://127.0.0.1:54321', // Local Supabase
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''), // Strip prefix
      }
    }
  }
})
