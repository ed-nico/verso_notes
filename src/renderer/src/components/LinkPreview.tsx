import { useEffect, useReducer, useRef } from 'react'
import { useStore } from '../store'
import { resolveTarget } from '../lib/links'

import { renderNote, type InlineOpts } from './NotePreview'

interface Hover {
  raw: string
  x: number
  y: number
}

// The preview opens when a link is hovered with ⌘/Ctrl held (either order). Once open
// it stays — you can move into it and scroll — until you leave it, scroll the page,
// click away, or press Escape.
let hovered: Hover | null = null
let modDown = false
let shown: Hover | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

function setShown(next: Hover | null): void {
  if (next === shown) return
  shown = next
  emit()
}
function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}
function show(p: Hover): void {
  clearHideTimer()
  setShown(p)
}
/** Hide after a short grace period (so the pointer can travel from link to popup). */
function scheduleHide(): void {
  clearHideTimer()
  hideTimer = setTimeout(() => setShown(null), 220)
}
function hideNow(): void {
  clearHideTimer()
  hovered = null
  setShown(null)
}

/** Report the pointer entering a resolvable link (called regardless of modifier). */
export function hoverLink(raw: string, x: number, y: number): void {
  clearHideTimer()
  hovered = { raw, x, y }
  if (modDown && (!shown || shown.raw !== raw)) show(hovered)
}

/** Report the pointer leaving a link. */
export function unhoverLink(): void {
  hovered = null
  if (shown) scheduleHide()
}

/** Mounted once at the app root; renders the floating preview while active. */
export function LinkPreview(): React.JSX.Element | null {
  const [, force] = useReducer((c: number) => c + 1, 0)
  const popupRef = useRef<HTMLDivElement>(null)
  const inPopup = (t: EventTarget | null): boolean => !!popupRef.current && t instanceof Node && popupRef.current.contains(t)

  useEffect(() => {
    listeners.add(force)
    const onKey = (e: KeyboardEvent): void => {
      const down = e.metaKey || e.ctrlKey
      if (down === modDown) return
      modDown = down
      // Pressing the modifier while hovering opens it; releasing leaves it open.
      if (down && hovered && !shown) show(hovered)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hideNow()
    }
    const onScroll = (e: Event): void => {
      if (!inPopup(e.target)) hideNow() // scrolling the page dismisses; scrolling inside doesn't
    }
    const onDown = (e: MouseEvent): void => {
      if (!inPopup(e.target)) hideNow()
    }
    const onBlur = (): void => {
      modDown = false
      hideNow()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKey)
    document.addEventListener('keydown', onEsc)
    window.addEventListener('blur', onBlur)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      listeners.delete(force)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKey)
      document.removeEventListener('keydown', onEsc)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const files = useStore((s) => s.files)
  const parsed = useStore((s) => s.parsed)
  const index = useStore((s) => s.index)
  const navigate = useStore((s) => s.navigate)
  const openTag = useStore((s) => s.openTag)

  if (!shown) return null
  const path =
    resolveTarget(
      shown.raw,
      files.map((f) => f.path)
    ) ?? index.resolvePath(shown.raw)
  if (!path) return null

  const note = parsed[path]
  const tags = note?.tags ?? []
  // Render the note formatted; links inside don't re-trigger previews, and clicking
  // one navigates (closing the popup).
  const opts: InlineOpts = {
    isResolved: (raw) => (resolveTarget(raw, files.map((f) => f.path)) ?? index.resolvePath(raw)) !== null,
    onNavigate: (raw, side) => {
      hideNow()
      void navigate(raw, side)
    },
    onTag: (t) => {
      hideNow()
      openTag(t)
    },
    noPreview: true
  }

  const W = 500
  const left = Math.max(8, Math.min(shown.x + 16, window.innerWidth - W - 12))
  const top = Math.max(8, Math.min(shown.y + 16, window.innerHeight * 0.35))

  return (
    <div
      className="hover-preview"
      ref={popupRef}
      style={{ left, top, width: W }}
      onMouseEnter={clearHideTimer}
      onMouseLeave={scheduleHide}
    >
      <div className="hp-title">{note?.name ?? path.replace(/\.md$/i, '')}</div>
      {/* `texts` is mutated in place, so a subscription to the map would never
          fire; the popup mounts fresh on each hover, which is when it matters. */}
      <div className="hp-full">{renderNote(useStore.getState().texts[path] ?? '', opts)}</div>
      {tags.length > 0 && (
        <div className="hp-meta">
          {tags.map((t) => (
            <span className="hp-pill" key={t}>
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
