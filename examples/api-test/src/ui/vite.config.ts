import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => {
  return {
    plugins: [solid({ ssr: true })],
    server: {
      port: 3001,
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: isSsrBuild ? {} : {
          manualChunks: {
            vendor: ['solid-js'],
          },
        },
      },
    },
    optimizeDeps: {
      include: ['solid-js'],
    },
  }
})
