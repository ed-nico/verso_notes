import { useState } from 'react'
import type { Callout as CalloutData } from '../lib/callouts'

/**
 * A rendered callout box (`> [!warning] Careful`). Fold state is component-local
 * on purpose: it's a view preference, not document content — the `-` marker in
 * the text only sets the STARTING state, so folding one shut never rewrites the
 * note. Remounting (an edit to the block) re-reads that marker, which is the
 * behaviour you want: the text is the source of truth.
 */
export function Callout({
  data,
  renderLine
}: {
  data: CalloutData
  /** Renders one line of body text as inline markdown (owned by the editor). */
  renderLine: (line: string, key: number) => React.ReactNode
}): React.JSX.Element {
  const [folded, setFolded] = useState(data.startFolded)
  const lines = data.body === '' ? [] : data.body.split('\n')
  const open = !data.foldable || !folded

  return (
    <div className="bl-callout" data-callout={data.kind.key}>
      <div
        className={'bl-callout-head' + (data.foldable ? ' foldable' : '')}
        role={data.foldable ? 'button' : undefined}
        tabIndex={data.foldable ? 0 : undefined}
        aria-expanded={data.foldable ? open : undefined}
        // The row beneath puts the caret in this block on mousedown; a fold
        // click must not also start editing.
        onMouseDown={(e) => data.foldable && e.stopPropagation()}
        onClick={() => data.foldable && setFolded((v) => !v)}
        onKeyDown={(e) => {
          if (data.foldable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setFolded((v) => !v)
          }
        }}
      >
        <span className="bl-callout-icon" aria-hidden="true">
          {data.kind.icon}
        </span>
        <span className="bl-callout-title">{data.title}</span>
        {data.foldable && <span className="bl-callout-caret">{open ? '▾' : '▸'}</span>}
      </div>
      {open && lines.length > 0 && (
        <div className="bl-callout-body">
          {lines.map((l, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {renderLine(l, i)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
