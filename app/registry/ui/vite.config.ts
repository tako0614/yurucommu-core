import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  base: '/admin/',
  plugins: [solid()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
