import { useMemo } from 'react'
import { useStore } from '../store'
import { resolveTarget } from '../lib/links'
import { renderInline } from './InlineMarkdown'

/** Live, read-only results for a `{{query ...}}` block. */
export function QueryView({ raw }: { raw: string }): React.JSX.Element {
  const index = useStore((s) => s.index)
  const files = useStore((s) => s.files)
  const openNote = useStore((s) => s.openNote)
  const navigate = useStore((s) => s.navigate)
  const toggleTask = useStore((s) => s.toggleTask)

  const results = useMemo(() => index.query(raw), [index, raw])

  const isResolved = (r: string): boolean =>
    (resolveTarget(r, files.map((f) => f.path)) ?? index.resolvePath(r)) !== null
  const opts = { isResolved, onNavigate: navigate }

  const jump = (path: string): void => openNote(path)

  return (
    <div className="queryview">
      <div className="queryview-head">
        query <code>{raw}</code> · {results.length}
      </div>
      {results.length === 0 && <div className="queryview-empty">No matching blocks</div>}
      {results.map((b, i) => (
        <div className="queryview-row" key={`${b.path}:${b.line}:${i}`}>
          {b.isTask && (
            <input
              type="checkbox"
              checked={b.checked}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={() => toggleTask(b.path, b.line)}
            />
          )}
          <span className={'queryview-text' + (b.checked ? ' done' : '')}>{renderInline(b.text, opts)}</span>
          <span className="queryview-src" onClick={() => jump(b.path)} title={b.path}>
            {b.name}
          </span>
        </div>
      ))}
    </div>
  )
}
