import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import 'solid-js'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: '../registry/public',
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      "_takopack": {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/_takopack/, '')
      }
    },
    port: 3001,
  }
})
