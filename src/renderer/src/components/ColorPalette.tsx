import { useEffect, useRef } from 'react'
import { OPTION_COLORS, type OptionColor } from '../lib/propColors'

/**
 * The swatch popup for highlighting outliner rows — the same nine tokens Select
 * options use, so a green in a table and a green on a row are the same green.
 *
 * Positioned `fixed` from the click point (like ContextMenu): the editor scrolls
 * and its rows clip, so an absolutely-positioned popup would be cut off.
 */
export function ColorPalette({
  x,
  y,
  current,
  count,
  onPick,
  onClose
}: {
  x: number
  y: number
  /** The colour already on the row, ringed in the palette. */
  current?: OptionColor
  /** How many rows this will paint, when it's more than one. */
  count: number
  onPick: (color: OptionColor | null) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 210)
  const top = Math.min(y, window.innerHeight - 90)

  return (
    <div className="color-pop" ref={ref} style={{ left, top }}>
      <div className="color-pop-head">{count > 1 ? `Highlight ${count} rows` : 'Highlight row'}</div>
      <div className="color-pop-swatches">
        {OPTION_COLORS.map((c) => (
          <button
            key={c}
            className={'opt-sw' + (current === c ? ' on' : '')}
            data-color={c}
            title={c}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
      <button className="color-pop-none" onClick={() => onPick(null)}>
        ⊘ No colour
      </button>
    </div>
  )
}
