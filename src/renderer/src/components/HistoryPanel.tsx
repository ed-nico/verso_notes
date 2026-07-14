import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { basename } from '../lib/links'
import { stripFrontmatter } from '../lib/frontmatter'

/** "2026-07-14T18-30-05" → "14 Jul 2026, 18:30" (snapshot stamps are filename-safe ISO). */
function stampLabel(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/.exec(stamp)
  if (!m) return stamp
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`
}

/**
 * Version history for one note: snapshots taken before overwrites (at most one
 * per 10 minutes, kept in `.verso/history/`). Pick a version to preview it;
 * Restore replaces the note's current text (itself snapshotted first, so a
 * restore is never destructive).
 */
export function HistoryPanel({ path, onClose }: { path: string; onClose: () => void }): React.JSX.Element {
  const editNote = useStore((s) => s.editNote)
  const [snaps, setSnaps] = useState<{ stamp: string; size: number }[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    void window.verso.listSnapshots(path).then((list) => {
      setSnaps(list)
      if (list.length) setSel(list[0].stamp)
    })
  }, [path])

  useEffect(() => {
    if (!sel) return
    void window.verso.readSnapshot(path, sel).then((t) => setPreview(t ?? ''))
  }, [path, sel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const restore = (): void => {
    if (!sel || !preview) return
    if (!window.confirm(`Replace the current “${basename(path)}” with the ${stampLabel(sel)} version?`)) return
    editNote(path, preview) // a normal edit: undoable, and the current text gets snapshotted
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal history-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>History — {basename(path)}</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        {snaps === null ? (
          <p className="empty-note">Loading…</p>
        ) : snaps.length === 0 ? (
          <p className="empty-note">
            No snapshots yet. Verso keeps one before overwriting a note (at most every 10 minutes) —
            keep writing and versions will appear here.
          </p>
        ) : (
          <div className="history-body">
            <div className="history-list">
              {snaps.map((s) => (
                <button
                  key={s.stamp}
                  className={'history-item' + (s.stamp === sel ? ' active' : '')}
                  onClick={() => setSel(s.stamp)}
                >
                  <span>{stampLabel(s.stamp)}</span>
                  <span className="history-size">{(s.size / 1024).toFixed(1)} KB</span>
                </button>
              ))}
            </div>
            <div className="history-preview">
              <pre>{stripFrontmatter(preview)}</pre>
              <button className="btn history-restore" onClick={restore} disabled={!sel || !preview}>
                Restore this version
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
