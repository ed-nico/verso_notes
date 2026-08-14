import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { dailyDateOf, formatLong, todayISO } from '../lib/dates'
import { hoverLink, unhoverLink } from './LinkPreview'

/**
 * "On this day" for the right sidebar, under the calendar: every daily note that
 * shares today's month + day, any year. Journal-only — App.tsx mounts it just for
 * `view: 'journal'`, since it's an almanac of the journal, not of the open note.
 *
 * Unlike SimilarNotes this keeps its header when empty: it's the only affordance
 * for the feature, so a vanished panel would read as a missing feature.
 */
export function OnThisDay(): React.JSX.Element {
  const today = todayISO()
  const files = useStore((s) => s.files)
  const parsed = useStore((s) => s.parsed)
  const openNote = useStore((s) => s.openNote)
  const [open, setOpen] = useState(true)

  const entries = useMemo(() => {
    const mmdd = today.slice(5)
    return files
      .map((f) => ({ path: f.path, iso: dailyDateOf(f.path) }))
      .filter((x): x is { path: string; iso: string } => !!x.iso && x.iso.slice(5) === mmdd)
      .sort((a, b) => (a.iso < b.iso ? 1 : -1))
  }, [files, today])

  return (
    <div className="otd">
      <button className="rightbar-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="rightbar-caret">{open ? '▾' : '▸'}</span>
        On this day
        {entries.length > 0 && <span className="rightbar-section-count">{entries.length}</span>}
      </button>
      {open && (
        <div className="otd-panel">
          {entries.length === 0 ? (
            <p className="otd-empty">No journal entries on this day yet.</p>
          ) : (
            entries.map(({ path, iso }) => (
              <div
                className="otd-item"
                key={path}
                role="link"
                tabIndex={0}
                onClick={() => openNote(path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    openNote(path)
                  }
                }}
                onMouseEnter={(e) => hoverLink(path.replace(/\.md$/i, ''), e.clientX, e.clientY)}
                onMouseLeave={() => unhoverLink()}
              >
                <span className="otd-date">{formatLong(iso)}</span>
                <span className="otd-excerpt">{parsed[path]?.excerpt || '—'}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
