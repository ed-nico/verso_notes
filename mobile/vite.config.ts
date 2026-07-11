import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Reuses the desktop app's pure parsing/link libs directly from ../src.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vlib': path.resolve(__dirname, '../src/renderer/src/lib'),
      '@shared': path.resolve(__dirname, '../src/shared')
    }
  },
  build: { outDir: 'dist' }
})
