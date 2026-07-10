import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { parseBlocks } from '../lib/blocks'

/** Reduce a heading's raw markdown to readable plain text for the outline. */
function strip(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, n: string, a?: string) => a || n)
    .replace(/[*_`~]/g, '')
    .trim()
}

/** A click-to-scroll outline of the active note's headings, for the right sidebar. */
export function TableOfContents({ path }: { path: string }): React.JSX.Element | null {
  const text = useStore((s) => s.texts[path] ?? '')
  const [open, setOpen] = useState(true)

  const headings = useMemo(() => {
    const hs = parseBlocks(text).blocks.filter((b) => b.type === 'heading')
    const min = hs.length ? Math.min(...hs.map((h) => h.level || 1)) : 1
    const counts = new Map<string, number>()
    return hs.map((h) => {
      const t = strip(h.text) || 'Untitled'
      const occ = counts.get(t) ?? 0 // disambiguate repeated heading text
      counts.set(t, occ + 1)
      return { text: t, depth: (h.level || 1) - min, occ }
    })
  }, [text])

  if (headings.length < 2) return null

  // Match by rendered text (+ occurrence) rather than index, so a collapsed
  // section in the editor doesn't throw the mapping off.
  const scrollTo = (target: string, occ: number): void => {
    const scope = document.querySelector('.main-body > .scroll-area')
    const els = Array.from(scope?.querySelectorAll('.bl-row.bl-heading .ol-content') ?? [])
    const matches = els.filter((el) => (el.textContent ?? '').trim() === target)
    const hit = (matches[occ] ?? matches[0])?.closest('.bl-row')
    hit?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="toc">
      <button className="rightbar-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="rightbar-caret">{open ? '▾' : '▸'}</span>
        Outline
        <span className="rightbar-section-count">{headings.length}</span>
      </button>
      {open && (
        <div className="toc-list">
          {headings.map((h, i) => (
            <button
              key={i}
              className="toc-item"
              style={{ paddingLeft: 4 + h.depth * 12 }}
              onClick={() => scrollTo(h.text, h.occ)}
              title={h.text}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
