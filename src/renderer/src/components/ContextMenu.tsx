import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  danger?: boolean
  onClick: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the menu within the viewport.
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - items.length * 32 - 12)

  return (
    <div className="ctx-menu" ref={ref} style={{ left, top }}>
      {items.map((item) => (
        <div
          key={item.label}
          className={'ctx-item' + (item.danger ? ' danger' : '')}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  )
}
