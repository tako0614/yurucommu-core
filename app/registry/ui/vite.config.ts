import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/admin/',
  plugins: [solid(),tailwindcss()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  }
})
