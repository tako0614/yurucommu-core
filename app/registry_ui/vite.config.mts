import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

import 'solid-js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [solid(),

  ],
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
    port: 3000,
  }
})
