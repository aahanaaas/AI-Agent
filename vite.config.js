import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, root, '')
  const apiTarget = env.VITE_API_BASE_URL?.trim()

  if (!apiTarget) {
    throw new Error('VITE_API_BASE_URL must be set in .env to configure the API proxy.')
  }

  const apiProxy = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: apiProxy },
    preview: { proxy: apiProxy },
  }
})
