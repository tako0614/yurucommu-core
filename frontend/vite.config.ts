import path from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => ({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      '@platform': path.resolve(__dirname, '../platform/src'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
}));
