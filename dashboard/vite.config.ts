import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';

  return {
    plugins: [react()],
    server: {
      port: 7500,
      strictPort: true, // Fail if port 6000 is taken
      allowedHosts: ['telemetry.pollbot.win', 'pollbot.win', 'localhost'],
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
          secure: false,
        },
        '/supabase/realtime': {
          target: supabaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/supabase/, ''),
          ws: true,
        },
        '/supabase': {
          target: supabaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/supabase/, ''), // Strip prefix
        }
      }
    }
  }
})
