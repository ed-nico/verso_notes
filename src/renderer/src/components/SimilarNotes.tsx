import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { similarNotes } from '../lib/similar'
import { basename, dirname, stripMd } from '../lib/links'
import { hoverLink, unhoverLink } from './LinkPreview'

/**
 * "Similar notes" for the right sidebar: TF-IDF cosine over the vault (fully
 * local, no models — see lib/similar.ts). Renders NOTHING when there's no
 * confident match (Reflect's rule: an empty panel beats a weak guess).
 */
export function SimilarNotes({ path }: { path: string }): React.JSX.Element | null {
  // Recompute on the debounced index rebuild — texts is mutated in place while
  // typing, so the index identity is the correct refresh signal (see TodosView).
  const index = useStore((s) => s.index)
  const openNote = useStore((s) => s.openNote)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const [open, setOpen] = useState(true)

  const hits = useMemo(() => {
    const texts = useStore.getState().texts
    return similarNotes(path, texts, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, index])

  if (!hits.length) return null

  return (
    <div className="similar">
      <button className="rightbar-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="rightbar-caret">{open ? '▾' : '▸'}</span>
        Similar notes
        <span className="rightbar-section-count">{hits.length}</span>
      </button>
      {open && (
        <div className="similar-list">
          {hits.map((h) => (
            <button
              key={h.path}
              className="similar-item"
              title={h.path}
              onClick={(e) => (e.metaKey || e.ctrlKey ? openInSidePane(h.path) : openNote(h.path))}
              onMouseEnter={(e) => hoverLink(stripMd(h.path), e.clientX, e.clientY)}
              onMouseLeave={() => unhoverLink()}
            >
              <span className="similar-name">{basename(h.path)}</span>
              {h.path.includes('/') && <span className="similar-dir">{dirname(h.path)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
