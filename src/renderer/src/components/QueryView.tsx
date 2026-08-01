import { useMemo } from 'react'
import { useStore } from '../store'
import { resolveTarget } from '../lib/links'
import { renderInline } from './InlineMarkdown'
import type { QueryBlock } from '../lib/query'

/** Live, read-only results for a `{{query ...}}` block. */
export function QueryView({ raw }: { raw: string }): React.JSX.Element {
  const index = useStore((s) => s.index)
  const files = useStore((s) => s.files)
  const openNote = useStore((s) => s.openNote)
  const navigate = useStore((s) => s.navigate)
  const toggleTask = useStore((s) => s.toggleTask)

  const result = useMemo(() => index.runQuery(raw), [index, raw])
  const { spec, blocks, groups, total } = result

  const isResolved = (r: string): boolean =>
    (resolveTarget(r, files.map((f) => f.path)) ?? index.resolvePath(r)) !== null
  const opts = { isResolved, onNavigate: navigate }

  const jump = (path: string): void => openNote(path)

  // "12" normally; "10 of 63" when a limit: is hiding some, so a truncated
  // result never passes for the whole answer.
  const count = blocks.length < total ? `${blocks.length} of ${total}` : String(total)

  const renderRows = (rows: QueryBlock[]): React.JSX.Element =>
    spec.layout === 'table' ? (
      <div className="queryview-tablewrap">
        <table className="queryview-table">
          <thead>
            <tr>
              <th>Block</th>
              <th>Note</th>
              <th>Date</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={`${b.path}:${b.line}:${i}`}>
                <td>
                  {b.isTask && (
                    <input
                      type="checkbox"
                      checked={b.checked}
                      aria-label={b.text}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={() => toggleTask(b.path, b.line)}
                    />
                  )}
                  <span className={b.checked ? 'done' : undefined}>{renderInline(b.text, opts)}</span>
                </td>
                <td>
                  <button className="queryview-src" onClick={() => jump(b.path)} title={b.path}>
                    {b.name}
                  </button>
                </td>
                <td className="queryview-date">{b.date ?? ''}</td>
                <td className="queryview-tags">{b.tags.map((t) => `#${t}`).join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <>
        {rows.map((b, i) => (
          <div className="queryview-row" key={`${b.path}:${b.line}:${i}`}>
            {b.isTask && (
              <input
                type="checkbox"
                checked={b.checked}
                aria-label={b.text}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={() => toggleTask(b.path, b.line)}
              />
            )}
            <span className={'queryview-text' + (b.checked ? ' done' : '')}>{renderInline(b.text, opts)}</span>
            <button className="queryview-src" onClick={() => jump(b.path)} title={b.path}>
              {b.name}
            </button>
          </div>
        ))}
      </>
    )

  return (
    <div className="queryview">
      <div className="queryview-head">
        query <code>{raw}</code> · {count}
      </div>
      {blocks.length === 0 && <div className="queryview-empty">No matching blocks</div>}
      {groups
        ? groups.map((g) => (
            <div className="queryview-group" key={g.label}>
              <div className="queryview-grouphead">
                {g.label}
                <span className="queryview-groupcount">{g.blocks.length}</span>
              </div>
              {renderRows(g.blocks)}
            </div>
          ))
        : renderRows(blocks)}
    </div>
  )
}
