import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit tests cover the pure parsing/indexing libs (no DOM, no Electron).
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
