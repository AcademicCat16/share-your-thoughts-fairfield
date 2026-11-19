import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /<repo>/.
export default defineConfig({
  base: '/share-your-thoughts-fairfield/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5320 },
})
