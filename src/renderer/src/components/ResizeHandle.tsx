import { useEffect, useRef, useState } from 'react'

/**
 * The drag strip on a side panel's inner edge.
 *
 * Listeners go on the WINDOW for the duration of the drag, not on the strip: the
 * pointer routinely outruns a 5px target, and a handler bound to the strip would
 * drop the drag the moment it did. `side` says which edge of the window the panel
 * is pinned to, which is what turns a clientX into a width.
 */
export function ResizeHandle({
  side,
  width,
  onResize,
  label
}: {
  side: 'left' | 'right'
  /** Current width, read once per drag as the starting point. */
  width: number
  onResize: (px: number) => void
  label: string
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent): void => {
      const dx = e.clientX - start.current.x
      onResize(start.current.w + (side === 'left' ? dx : -dx))
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // Kill text selection and cursor flicker for the whole drag, not per element.
    document.body.classList.add('resizing-col')
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-col')
    }
  }, [dragging, side, onResize])

  return (
    <div
      className={'resize-handle ' + side + (dragging ? ' on' : '')}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onMouseDown={(e) => {
        e.preventDefault()
        start.current = { x: e.clientX, w: width }
        setDragging(true)
      }}
      // Keyboard parity: the panel is reachable without a mouse, so its size is too.
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        if (e.key === 'ArrowLeft') onResize(width + (side === 'left' ? -step : step))
        else if (e.key === 'ArrowRight') onResize(width + (side === 'left' ? step : -step))
        else return
        e.preventDefault()
      }}
    />
  )
}
