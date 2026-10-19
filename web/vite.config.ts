import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => ({
  root: 'web',
  plugins: [vue()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    // Keep browser Host and Origin aligned for the backend's same-origin guard.
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: { outDir: process.env.TRAINER_STATIC_DIR || (mode === 'journey' ? 'dist-journey' : 'dist'), emptyOutDir: true },
}))
