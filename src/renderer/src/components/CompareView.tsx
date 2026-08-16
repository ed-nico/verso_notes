import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { diffLines } from '../lib/diff'
import { basename } from '../lib/links'

/**
 * Side-by-side compare of two notes, opened from Tend's duplicates.
 *
 * The report can tell you two notes are 94% the same; it can't tell you which to
 * keep. That is always a judgement about the 6% — so this shows the differing
 * lines rather than a score, and offers to open either side rather than offering
 * to merge them. Nothing here writes: deciding what a duplicate MEANS (keep,
 * merge, link) is the user's, and a wrong automatic merge is unrecoverable.
 */
export function CompareView({
  a,
  b,
  onClose
}: {
  a: string
  b: string
  onClose: () => void
}): React.JSX.Element {
  const openNote = useStore((s) => s.openNote)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const [onlyDiff, setOnlyDiff] = useState(true)

  const { rows, sameRatio, tooLarge } = useMemo(() => {
    const texts = useStore.getState().texts
    return diffLines(texts[a] ?? '', texts[b] ?? '')
  }, [a, b])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Collapsing runs of identical lines is what makes a 94%-identical pair
  // readable: without it the differences are a handful of rows in a wall of
  // matching ones. A little context on each side of a change keeps it legible.
  const shown = useMemo(() => {
    if (!onlyDiff) return rows.map((r, i) => ({ r, i }))
    const keep = new Set<number>()
    rows.forEach((r, i) => {
      if (r.kind === 'same') return
      for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < rows.length) keep.add(k)
    })
    return [...keep].sort((x, y) => x - y).map((i) => ({ r: rows[i], i }))
  }, [rows, onlyDiff])

  const changed = rows.filter((r) => r.kind !== 'same').length

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Compare</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="compare-bar">
          <span className="compare-stat">
            {Math.round(sameRatio * 100)}% identical · {changed} differing {changed === 1 ? 'line' : 'lines'}
          </span>
          <label className="compare-toggle">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            Differences only
          </label>
        </div>

        <div className="compare-heads">
          <div className="compare-head">
            <button className="compare-open" onClick={() => (onClose(), openNote(a))}>
              {basename(a)}
            </button>
            <button className="compare-side" title="Open beside" onClick={() => (onClose(), openInSidePane(a))}>
              ◫
            </button>
          </div>
          <div className="compare-head">
            <button className="compare-open" onClick={() => (onClose(), openNote(b))}>
              {basename(b)}
            </button>
            <button className="compare-side" title="Open beside" onClick={() => (onClose(), openInSidePane(b))}>
              ◫
            </button>
          </div>
        </div>

        {tooLarge ? (
          <p className="compare-note">These notes are too long to diff line by line — open them side by side instead.</p>
        ) : changed === 0 ? (
          <p className="compare-note">These two notes are identical, character for character.</p>
        ) : (
          <div className="compare-body">
            {shown.map(({ r, i }, k) => (
              <div key={i}>
                {/* A break wherever collapsed identical lines were skipped. */}
                {k > 0 && shown[k - 1].i !== i - 1 && <div className="compare-gap">⋯</div>}
                <div className={'compare-row ' + r.kind}>
                  <div className="compare-cell left">{r.a ?? ''}</div>
                  <div className="compare-cell right">{r.b ?? ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
