import { useEffect, useRef, useState } from 'react'
import type { OptionColor } from '../lib/propColors'

/**
 * The dropdown for Select properties, shared by the Properties panel, entity cards
 * and the Bases table so a value looks the same everywhere it can be edited.
 *
 * Not a native `<select>`: macOS draws that popup itself and ignores per-`<option>`
 * colours, which is the whole point here — so the menu is our own, positioned
 * `fixed` from the trigger's rect (the panels it opens in scroll and clip).
 */

/** One coloured value. `color` undefined renders the neutral, uncoloured chip. */
export function OptionChip({
  value,
  color
}: {
  value: string
  color?: OptionColor
}): React.JSX.Element {
  return (
    <span className="opt-chip" data-color={color ?? 'none'}>
      {value}
    </span>
  )
}

export function SelectChip({
  value,
  options,
  colors,
  onCommit,
  autoOpen,
  onClose
}: {
  value: string
  options: string[]
  colors?: Record<string, OptionColor>
  onCommit: (v: string) => void
  /** Open the menu on mount — for click-to-edit cells, which already took a click. */
  autoOpen?: boolean
  /** Called when the menu closes, so a click-to-edit cell can leave edit mode. */
  onClose?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(autoOpen ?? false)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const close = (): void => {
    setOpen(false)
    onClose?.()
  }

  // Anchor the menu under the trigger, kept inside the viewport.
  useEffect(() => {
    if (!open) return
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.max(r.width, 150)
    const height = Math.min((options.length + 1) * 30 + 10, 320)
    setAt({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 4 + height > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4,
      width
    })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
    // `close` is stable enough here (it only calls setState + the onClose prop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep an off-list current value selectable so editing the options never hides data.
  const all = value && !options.includes(value) ? [value, ...options] : options

  const pick = (v: string): void => {
    onCommit(v)
    close()
  }

  return (
    <>
      <button
        ref={btn}
        className="sel-chip"
        title="Choose a value"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            close()
          }
        }}
      >
        {value ? <OptionChip value={value} color={colors?.[value]} /> : <span className="sel-empty">—</span>}
        <span className="sel-caret">⌄</span>
      </button>
      {open && at && (
        <div className="sel-menu" ref={menu} style={{ left: at.left, top: at.top, minWidth: at.width }}>
          <div className="sel-item" onClick={() => pick('')}>
            <span className="sel-empty">— none</span>
          </div>
          {all.map((o) => (
            <div
              key={o}
              className={'sel-item' + (o === value ? ' on' : '')}
              onClick={() => pick(o)}
            >
              <OptionChip value={o} color={colors?.[o]} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
