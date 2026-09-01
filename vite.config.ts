import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const ADMIN_CONFIG_FN = 'https://us-west1-salish-sea-property-mapper.cloudfunctions.net/admin-config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/admin/categories': {
        target: ADMIN_CONFIG_FN,
        changeOrigin: true,
        // Strip just the route prefix so query strings (e.g. ?verify=1) survive
        rewrite: (path) => path.replace(/^\/api\/admin\/categories/, ''),
      },
      '/api/admin/content': {
        target: ADMIN_CONFIG_FN,
        changeOrigin: true,
        // Same function, /content sub-path (site content document)
        rewrite: (path) => path.replace(/^\/api\/admin\/content/, '/content'),
      },
    },
  },
})
