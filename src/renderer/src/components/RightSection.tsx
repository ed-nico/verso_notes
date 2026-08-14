import { useCallback, useState } from 'react'

/**
 * Open/closed state for a right-panel section, remembered across note switches
 * and restarts.
 *
 * Component state alone isn't enough: the panels are keyed by note path so they
 * remount on every navigation, which threw away the choice the moment you opened
 * another note. Collapsing a section you don't want is only worth doing if it
 * stays collapsed.
 */
export function useSectionOpen(key: string, initial: boolean): [boolean, () => void] {
  const storageKey = `verso-section-${key}`
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(storageKey)
    return v === null ? initial : v === '1'
  })
  const toggle = useCallback(() => {
    setOpen((v) => {
      localStorage.setItem(storageKey, v ? '0' : '1')
      return !v
    })
  }, [storageKey])
  return [open, toggle]
}

/**
 * A titled, collapsible section of the right panel.
 *
 * The panel used to render Properties, Outline, Similar notes and the local graph
 * all at once, always. Each is useful sometimes and none constantly, so the column
 * read as clutter and got closed wholesale — taking Properties, which IS constantly
 * useful, with it. Sections let the panel be shaped once and then left alone.
 */
export function RightSection({
  id,
  title,
  count,
  defaultOpen = true,
  children
}: {
  id: string
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, toggle] = useSectionOpen(id, defaultOpen)
  return (
    <div className={'rightbar-section' + (open ? '' : ' closed')}>
      <button className="rightbar-section-head" onClick={toggle} aria-expanded={open}>
        <span className="rightbar-caret">{open ? '▾' : '▸'}</span>
        {title}
        {count !== undefined && <span className="rightbar-section-count">{count}</span>}
      </button>
      {open && children}
    </div>
  )
}
