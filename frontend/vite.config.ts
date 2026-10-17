/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  // MapLibre alone is ~1 MB; a single chunk is fine for a prototype.
  build: { chunkSizeWarningLimit: 2000 },
  // MapLibre's worker is an ES module that imports a shared chunk.
  worker: { format: 'es' },
  // The FastAPI backend runs on :8000; proxying keeps everything same-origin.
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
})
