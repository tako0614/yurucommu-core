import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, '../../dist'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
