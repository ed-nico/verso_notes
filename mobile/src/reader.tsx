/** Rendered read-view of blocks — shared by the note screen and the journal feed. */
import { parseTable, isList, type Block } from '@vlib/blocks'
import { renderInline } from './inline'

export interface BlockViewProps {
  b: Block
  onWikilink: (t: string) => void
  onToggleTask: (id: number) => void
}

export function BlockView({ b, onWikilink, onToggleTask }: BlockViewProps): React.JSX.Element {
  const opts = { onWikilink, onUrl: (u: string) => window.open(u, '_blank') }
  if (b.type === 'code')
    return (
      <pre className="code">
        <code>{b.text}</code>
      </pre>
    )
  if (b.type === 'table') {
    const { header, rows } = parseTable(b.text)
    return (
      <div className="md-table-scroll">
        <table className="md-table">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i}>{renderInline(h, opts)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{renderInline(c, opts)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (b.type === 'heading') {
    const H = `h${Math.min(b.level || 1, 4)}` as 'h1' | 'h2' | 'h3' | 'h4'
    return <H>{renderInline(b.text, opts)}</H>
  }
  if (b.type === 'task')
    return (
      <div className="li task" style={{ marginLeft: b.level * 18 }}>
        <input type="checkbox" checked={!!b.checked} onChange={() => onToggleTask(b.id)} />
        <span className={b.checked ? 'done' : ''}>{renderInline(b.text, opts)}</span>
      </div>
    )
  if (isList(b))
    return (
      <div className="li" style={{ marginLeft: b.level * 18 }}>
        <span className="dot">{b.ordered ? `${b.ordinal ?? 1}.` : '•'}</span>
        <span>{renderInline(b.text, opts)}</span>
      </div>
    )
  if (b.text === '---') return <hr />
  return <p>{renderInline(b.text, opts)}</p>
}
