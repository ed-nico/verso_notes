import { useEffect, useRef, useState } from 'react'
import { parseTable } from '../lib/blocks'

/** Serialize a header + rows back to a clean Markdown pipe table. */
function serializeTable(header: string[], rows: string[][]): string {
  const esc = (c: string): string => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const line = (cells: string[]): string => '| ' + cells.join(' | ') + ' |'
  const head = line(header.map(esc))
  const sep = '| ' + header.map(() => '---').join(' | ') + ' |'
  const body = rows.map((r) => line(header.map((_, i) => esc(r[i] ?? ''))))
  return [head, sep, ...body].join('\n')
}

const DEFAULT_COL = 140
const MIN_COL = 48

/** A spreadsheet-style editor for a table block: edit cells inline, add/remove rows & columns. */
export function TableEditor({
  text,
  widths: initialWidths,
  onChange,
  onWidths,
  onExit
}: {
  text: string
  widths?: number[]
  onChange: (md: string) => void
  onWidths?: (widths: number[]) => void
  onExit: () => void
}): React.JSX.Element {
  const init = parseTable(text)
  const [header, setHeader] = useState<string[]>(init.header.length ? init.header : ['Column', 'Column'])
  const [rows, setRows] = useState<string[][]>(init.rows.length ? init.rows : [['', '']])
  // Column widths persist via the note's `_tableWidths` frontmatter (Markdown tables can't
  // carry them). Seed from the saved widths, padding/truncating to the current column count.
  const [widths, setWidths] = useState<number[]>(() =>
    header.map((_, i) => initialWidths?.[i] ?? DEFAULT_COL)
  )
  const firstCell = useRef<HTMLInputElement>(null)

  // Land focus in a cell as soon as the grid opens, so there's a visible caret immediately
  // (entering edit mode otherwise leaves nothing focused).
  useEffect(() => {
    firstCell.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const push = (h: string[], r: string[][]): void => {
    setHeader(h)
    setRows(r)
    onChange(serializeTable(h, r))
  }

  const setHeaderCell = (c: number, v: string): void => {
    const h = [...header]
    h[c] = v
    push(h, rows)
  }
  const setCell = (ri: number, ci: number, v: string): void => {
    const r = rows.map((row) => [...row])
    while (r[ri].length < header.length) r[ri].push('')
    r[ri][ci] = v
    push(header, r)
  }
  const addRow = (): void => push(header, [...rows, header.map(() => '')])
  const addCol = (): void => {
    push([...header, 'Column'], rows.map((r) => [...r, '']))
    const next = [...widths, DEFAULT_COL]
    setWidths(next)
    onWidths?.(next)
  }
  const delRow = (ri: number): void => {
    const next = rows.filter((_, i) => i !== ri)
    push(header, next.length ? next : [header.map(() => '')])
  }
  const delCol = (ci: number): void => {
    if (header.length <= 1) return
    push(header.filter((_, i) => i !== ci), rows.map((r) => r.filter((_, i) => i !== ci)))
    const next = widths.filter((_, i) => i !== ci)
    setWidths(next)
    onWidths?.(next)
  }

  // Drag the right edge of a header cell to resize that column.
  const startResize = (ci: number, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widths[ci] ?? DEFAULT_COL
    let latest = widths
    const onMove = (ev: MouseEvent): void => {
      const next = Math.max(MIN_COL, startW + (ev.clientX - startX))
      setWidths((w) => {
        const out = [...w]
        while (out.length < header.length) out.push(DEFAULT_COL)
        out[ci] = next
        latest = out
        return out
      })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('col-resizing')
      onWidths?.(latest) // persist once, at drag end
    }
    document.body.classList.add('col-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="tbl-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onExit()
        }
      }}
    >
      <table className="tbl-grid">
        <colgroup>
          {header.map((_, ci) => (
            <col key={ci} style={{ width: (widths[ci] ?? DEFAULT_COL) + 'px' }} />
          ))}
          <col style={{ width: '28px' }} />
        </colgroup>
        <thead>
          <tr>
            {header.map((h, ci) => (
              <th key={ci}>
                <div className="tbl-cellwrap">
                  <input
                    className="tbl-cell tbl-head"
                    value={h}
                    placeholder="Column"
                    onChange={(e) => setHeaderCell(ci, e.target.value)}
                  />
                  {header.length > 1 && (
                    <button className="tbl-del" title="Delete column" onClick={() => delCol(ci)}>
                      ×
                    </button>
                  )}
                </div>
                <span
                  className="tbl-resize"
                  title="Drag to resize column"
                  onMouseDown={(e) => startResize(ci, e)}
                />
              </th>
            ))}
            <th className="tbl-corner">
              <button className="tbl-add" title="Add column" onClick={addCol}>
                ＋
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {header.map((_, ci) => (
                <td key={ci}>
                  <input
                    ref={ri === 0 && ci === 0 ? firstCell : undefined}
                    className="tbl-cell"
                    value={r[ci] ?? ''}
                    onChange={(e) => setCell(ri, ci, e.target.value)}
                  />
                </td>
              ))}
              <td className="tbl-rowctl">
                <button className="tbl-del" title="Delete row" onClick={() => delRow(ri)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-actions">
        <button className="btn-sm" onClick={addRow}>
          ＋ Row
        </button>
        <button className="btn-sm" onClick={onExit}>
          Done
        </button>
      </div>
    </div>
  )
}
