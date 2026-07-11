/// <reference types="vite/client" />
import type { VersoApi } from '../../shared/types'

declare global {
  interface Window {
    verso: VersoApi
  }
}

export {}
