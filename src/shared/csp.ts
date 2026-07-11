/**
 * The production Content-Security-Policy, shared between the main process (which
 * injects it as a response header — see main/index.ts applyCsp) and the build config
 * (which bakes it into index.html as a <meta> fallback, so the policy holds even if
 * onHeadersReceived doesn't fire for the top-level file:// document).
 *
 * Dev uses a permissive header-only policy instead (Vite HMR needs eval/ws), so the
 * meta tag is injected only at build time — never into the dev-served index.html.
 */
export const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: verso:",
  "font-src 'self' data:",
  "connect-src 'self' verso:",
  "worker-src 'self' blob:",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')
