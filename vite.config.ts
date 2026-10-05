import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist-web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
})
