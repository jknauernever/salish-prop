import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/admin/categories': {
        target: 'https://us-west1-salish-sea-property-mapper.cloudfunctions.net/admin-config',
        changeOrigin: true,
        rewrite: () => '',
      },
    },
  },
})
