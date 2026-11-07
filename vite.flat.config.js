// Builds the website with every file in ONE flat folder (no sub-folders), for hosting via
// GitHub's web uploader. Output: web/dist-flat
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: 'dist-flat', emptyOutDir: true, assetsDir: '', chunkSizeWarningLimit: 1500 },
  server: { fs: { allow: ['..'] } },
})
