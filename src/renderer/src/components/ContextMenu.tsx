import { useEffect, useRef, useState } from 'react'

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
  // Keyboard navigation: ↑/↓ move, Enter activates, Escape closes. -1 until the
  // first arrow press so a mouse-opened menu doesn't show a phantom highlight.
  const [sel, setSel] = useState(-1)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  // Focus the menu so arrow keys land here, not on whatever was focused before.
  useEffect(() => {
    ref.current?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => (s + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => (s <= 0 ? items.length - 1 : s - 1))
    } else if (e.key === 'Enter' && sel >= 0 && sel < items.length) {
      e.preventDefault()
      items[sel].onClick()
      onClose()
    }
  }

  // Keep the menu within the viewport.
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - items.length * 32 - 12)

  return (
    <div
      className="ctx-menu"
      ref={ref}
      style={{ left, top }}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          role="menuitem"
          className={'ctx-item' + (item.danger ? ' danger' : '') + (i === sel ? ' kbd-sel' : '')}
          onMouseEnter={() => setSel(i)}
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
