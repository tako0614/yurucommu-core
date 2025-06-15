import { defineConfig } from 'vite'

export default defineConfig({
  base: '/admin/',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
