import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// base './' keeps asset links relative, so the built site works on any static host or sub-folder
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { fs: { allow: ['..'] } },
})
