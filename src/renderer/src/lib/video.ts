/** Recognise video-sharing URLs and turn them into in-app embeds + timestamps. */

export type VideoProvider = 'youtube' | 'vimeo' | 'loom'

export interface VideoRef {
  provider: VideoProvider
  /** Provider-specific video id. */
  id: string
  /** Optional start time (seconds) parsed from the URL. */
  start?: number
}

/** Stable key identifying one embedded player (provider + id). */
export function videoKey(v: VideoRef): string {
  return `${v.provider}:${v.id}`
}

/** Parse a `t=`/`#t=` start time: supports raw seconds or `1h2m3s`. */
function parseStart(url: string): number | undefined {
  const m = url.match(/[?#&]t=([0-9hms]+)/i)
  if (!m) return undefined
  const v = m[1]
  if (/^\d+$/.test(v)) return Number(v)
  const h = Number(v.match(/(\d+)h/)?.[1] ?? 0)
  const min = Number(v.match(/(\d+)m/)?.[1] ?? 0)
  const s = Number(v.match(/(\d+)s/)?.[1] ?? 0)
  const total = h * 3600 + min * 60 + s
  return total || undefined
}

/** Recognise a YouTube/Vimeo/Loom URL, or null if it isn't one. */
export function parseVideoUrl(url: string): VideoRef | null {
  let m: RegExpMatchArray | null
  if (
    (m = url.match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i
    ))
  ) {
    return { provider: 'youtube', id: m[1], start: parseStart(url) }
  }
  if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) {
    return { provider: 'vimeo', id: m[1], start: parseStart(url) }
  }
  if ((m = url.match(/loom\.com\/(?:share|embed)\/([\w-]+)/i))) {
    return { provider: 'loom', id: m[1] }
  }
  return null
}

/** The iframe src for a video, with the JS API enabled so timestamps can seek it. */
export function embedUrl(v: VideoRef): string {
  switch (v.provider) {
    case 'youtube':
      return `https://www.youtube.com/embed/${v.id}?enablejsapi=1&rel=0${v.start ? `&start=${v.start}` : ''}`
    case 'vimeo':
      return `https://player.vimeo.com/video/${v.id}${v.start ? `#t=${v.start}s` : ''}`
    case 'loom':
      return `https://www.loom.com/embed/${v.id}`
  }
}

/** Whether this provider supports click-to-seek timestamps (Loom doesn't expose seeking). */
export function supportsTimestamps(provider: VideoProvider): boolean {
  return provider === 'youtube' || provider === 'vimeo'
}

/** Seconds → "m:ss" or "h:mm:ss". */
export function formatTimestamp(total: number): string {
  const t = Math.max(0, Math.floor(total))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "m:ss" / "h:mm:ss" / raw seconds → seconds, or null. */
export function parseTimestamp(s: string): number | null {
  const t = s.trim()
  if (/^\d+$/.test(t)) return Number(t)
  const parts = t.split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => Number.isNaN(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}
