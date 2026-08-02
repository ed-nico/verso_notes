import { useMemo } from 'react'
import { useStore } from '../store'
import { resolveTarget } from '../lib/links'
import { renderInline } from './InlineMarkdown'
import { noteColumn, type QueryBlock, type QueryNote } from '../lib/query'

/** Default columns when a `scope:notes` query doesn't name any. */
const DEFAULT_COLS = ['name', 'tags', 'date']

/** Format a column value for a cell. */
function cell(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  return String(v)
}

/** Live, read-only results for a `{{query ...}}` block. */
export function QueryView({ raw, onEdit }: { raw: string; onEdit?: () => void }): React.JSX.Element {
  const index = useStore((s) => s.index)
  const files = useStore((s) => s.files)
  const previewInSidePane = useStore((s) => s.previewInSidePane)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const navigate = useStore((s) => s.navigate)
  const toggleTask = useStore((s) => s.toggleTask)

  const result = useMemo(() => index.runQuery(raw), [index, raw])
  const { spec, blocks, notes, groups, total } = result
  const cols = spec.cols?.length ? spec.cols : DEFAULT_COLS

  const isResolved = (r: string): boolean =>
    (resolveTarget(r, files.map((f) => f.path)) ?? index.resolvePath(r)) !== null
  const opts = { isResolved, onNavigate: navigate }

  // Results open BESIDE the query, not over it: the list is the thing you came
  // back to. ⌘-click adds a further pane instead of reusing the last one.
  const jump = (path: string, e?: { metaKey: boolean; ctrlKey: boolean }): void =>
    e && (e.metaKey || e.ctrlKey) ? openInSidePane(path) : previewInSidePane(path)

  // "12" normally; "10 of 63" when a limit: is hiding some, so a truncated
  // result never passes for the whole answer.
  const shownCount = notes ? notes.length : blocks.length
  const count = shownCount < total ? `${shownCount} of ${total}` : String(total)

  /** Note rows — a table of columns, or a gallery of cards. */
  const renderNotes = (rows: QueryNote[]): React.JSX.Element =>
    spec.layout === 'gallery' ? (
      <div className="queryview-gallery">
        {rows.map((n) => (
          <button
            className="queryview-card"
            key={n.path}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => jump(n.path, e)}
            title={n.path}
          >
            <span className="queryview-card-name">{n.name}</span>
            {cols
              .filter((c) => c.toLowerCase() !== 'name')
              .map((c) => {
                const v = noteColumn(n, c)
                if (v === undefined || v === null || v === '') return null
                return (
                  <span className="queryview-card-field" key={c}>
                    <span className="queryview-card-key">{c}</span>
                    {cell(v)}
                  </span>
                )
              })}
          </button>
        ))}
      </div>
    ) : (
      <div className="queryview-tablewrap">
        <table className="queryview-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c.replace(/_/g, ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.path}>
                {cols.map((c, i) => (
                  <td key={c}>
                    {i === 0 ? (
                      <button
                        className="queryview-src"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => jump(n.path, e)}
                        title={n.path}
                      >
                        {cell(noteColumn(n, c))}
                      </button>
                    ) : (
                      cell(noteColumn(n, c))
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

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
                  <button
                    className="queryview-src"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => jump(b.path, e)}
                    title={b.path}
                  >
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
            <button
                    className="queryview-src"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => jump(b.path, e)}
                    title={b.path}
                  >
              {b.name}
            </button>
          </div>
        ))}
      </>
    )

  return (
    <div className="queryview">
      <div className="queryview-head">
        {onEdit ? (
          // Editing the raw text still works — this just means you never have to.
          <button
            className="queryview-edit"
            title="Edit this query"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onEdit}
          >
            ⚙ edit
          </button>
        ) : (
          'query '
        )}
        <code>{raw}</code> · {count}
      </div>
      {total === 0 && (
        <div className="queryview-empty">
          {spec.scope === 'notes' ? 'No matching notes' : 'No matching blocks'}
        </div>
      )}
      {groups
        ? groups.map((g) => (
            <div className="queryview-group" key={g.label}>
              <div className="queryview-grouphead">
                {g.label}
                <span className="queryview-groupcount">{(g.notes ?? g.blocks).length}</span>
              </div>
              {g.notes ? renderNotes(g.notes) : renderRows(g.blocks)}
            </div>
          ))
        : notes
          ? renderNotes(notes)
          : renderRows(blocks)}
    </div>
  )
}
