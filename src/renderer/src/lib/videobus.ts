/**
 * Bridges embedded video players (iframes) with the rest of the app so a timestamp link
 * can seek the player, and "insert timestamp" can read the current play position.
 *
 * Control is done with the providers' postMessage protocols — no external API scripts —
 * so it works under a strict CSP.
 */
import type { VideoProvider } from './video'

interface Player {
  el: HTMLIFrameElement
  provider: VideoProvider
}

const players = new Map<string, Player>() // videoKey -> player
const times = new Map<string, number>() // videoKey -> last known currentTime (seconds)

/** Register an embed's iframe so timestamps can target it. Returns an unregister fn. */
export function registerPlayer(key: string, provider: VideoProvider, el: HTMLIFrameElement): () => void {
  players.set(key, { el, provider })
  return () => {
    if (players.get(key)?.el === el) {
      players.delete(key)
      times.delete(key)
    }
  }
}

function post(p: Player, message: unknown): void {
  p.el.contentWindow?.postMessage(typeof message === 'string' ? message : JSON.stringify(message), '*')
}

/** Ask the provider to start streaming play-time + state events to us. */
export function startListening(key: string): void {
  const p = players.get(key)
  if (!p) return
  if (p.provider === 'youtube') {
    post(p, { event: 'listening', id: key, channel: 'widget' })
  } else if (p.provider === 'vimeo') {
    post(p, { method: 'addEventListener', value: 'timeupdate' })
  }
}

/** Seek the player to `seconds` and play. No-op for providers without seek (Loom). */
export function seekPlayer(key: string, seconds: number): boolean {
  const p = players.get(key)
  if (!p) return false
  if (p.provider === 'youtube') {
    post(p, { event: 'command', func: 'seekTo', args: [seconds, true] })
    post(p, { event: 'command', func: 'playVideo', args: [] })
    return true
  }
  if (p.provider === 'vimeo') {
    post(p, { method: 'setCurrentTime', value: seconds })
    post(p, { method: 'play' })
    return true
  }
  return false
}

/** Last known play position for a player (from streamed events), or undefined. */
export function currentTime(key: string): number | undefined {
  return times.get(key)
}

/** Most recently active player (last to report a time), for "insert timestamp" with no explicit target. */
let lastActive: string | null = null
export function activePlayerKey(): string | null {
  return lastActive ?? (players.size === 1 ? [...players.keys()][0] : null)
}

// A single global listener parses time/state messages from every embedded provider.
let installed = false
export function installVideoListener(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('message', (e: MessageEvent) => {
    const origin = e.origin
    if (!/(youtube\.com|youtube-nocookie\.com|vimeo\.com)$/.test(new URL(origin).hostname.replace(/^www\./, ''))) {
      // Not from a known video origin — ignore.
    }
    let data: unknown = e.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return
      }
    }
    if (!data || typeof data !== 'object') return
    const d = data as Record<string, any>
    // YouTube infoDelivery carries info.currentTime; match it to the player by its window.
    let time: number | undefined
    if (d.event === 'infoDelivery' && d.info && typeof d.info.currentTime === 'number') {
      time = d.info.currentTime
    } else if (d.event === 'timeupdate' && typeof d.data?.seconds === 'number') {
      time = d.data.seconds // vimeo
    }
    if (time === undefined) return
    for (const [key, p] of players) {
      if (p.el.contentWindow === e.source) {
        times.set(key, time)
        lastActive = key
        return
      }
    }
  })
}
