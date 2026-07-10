import { Fragment, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { assetUrl } from '../lib/assets'
import { passesFilter, type AggKind, type Base } from '../lib/bases'
import { parseLooseDate } from '../lib/dates'
import { propOptions, storedPropType, typeOf, type PropType } from './PropertiesPanel'
import type { ParsedNote } from '@shared/types'
import type { VaultIndex } from '../lib/vault'

const AGGS: { kind: AggKind; label: string }[] = [
  { kind: 'none', label: '—' },
  { kind: 'sum', label: 'Sum' },
  { kind: 'avg', label: 'Average' },
  { kind: 'min', label: 'Min' },
  { kind: 'max', label: 'Max' },
  { kind: 'count', label: 'Count' }
]

export interface Row {
  path: string
  name: string
  tags: string[]
  backlinks: number
  fm: Record<string, unknown>
}

function imageValue(v: unknown): string | null {
  return typeof v === 'string' && /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(v.trim()) ? v.trim() : null
}

export function cellValue(row: Row, key: string): unknown {
  if (key === 'name') return row.name
  if (key === 'backlinks') return row.backlinks
  if (key === 'tags') return row.tags.join(', ')
  if (key === 'cover') {
    for (const v of Object.values(row.fm)) if (imageValue(v)) return imageValue(v)
    return undefined
  }
  return row.fm[key]
}

function renderCell(row: Row, key: string): React.ReactNode {
  if (key === 'tags') return row.tags.map((t) => <span className="pill" key={t}>#{t}</span>)
  const v = cellValue(row, key)
  const img = imageValue(v)
  if (img) return <img className="base-thumb" src={assetUrl(img)} alt="" loading="lazy" />
  if (Array.isArray(v)) return v.map((x, i) => <span className="pill" key={i}>{String(x)}</span>)
  if (v === undefined || v === null || v === '') return <span className="db-empty">—</span>
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  return String(v)
}

/** A whole column's editor type — resolved once from all rows so editing is consistent
 *  even for empty cells: an explicit `_types` choice on any note wins, else the type is
 *  inferred from the first non-empty value, so a date column edits as a date everywhere. */
function columnType(rows: Row[], key: string): PropType {
  for (const r of rows) {
    const t = storedPropType(r.fm, key)
    if (t) return t
  }
  for (const r of rows) {
    const v = r.fm[key]
    if (v !== undefined && v !== null && v !== '') return typeOf(v)
  }
  return 'text'
}

/** A select column's options, taken from the first note that defines them. */
function columnOptions(rows: Row[], key: string): string[] {
  for (const r of rows) {
    const o = propOptions(r.fm, key)
    if (o.length) return o
  }
  return []
}

/** Click-to-edit a frontmatter cell in the interactive Bases table. Writes back to the
 *  note's frontmatter using the column's type (so a Select stays a dropdown, a Date a
 *  date picker, etc. — even when this particular cell is empty). */
function EditableDataCell({
  row,
  col,
  type,
  options
}: {
  row: Row
  col: string
  type: PropType
  options: string[]
}): React.JSX.Element {
  const setNoteProperties = useStore((s) => s.setNoteProperties)
  const [editing, setEditing] = useState(false)
  const cancel = useRef(false)
  const v = row.fm[col]
  const commit = (value: unknown): void => void setNoteProperties(row.path, { ...row.fm, [col]: value })
  const done = (): void => setEditing(false)

  if (type === 'checkbox') {
    return (
      <span className="db-cell-check" title="Toggle" onClick={() => commit(!(v === true))}>
        {v === true ? '✓' : '✗'}
      </span>
    )
  }
  if (!editing) {
    return (
      <div className="db-cell-edit" title="Click to edit" onClick={() => setEditing(true)}>
        {renderCell(row, col)}
      </div>
    )
  }
  if (type === 'select') {
    const cur = typeof v === 'string' ? v : ''
    const all = cur && !options.includes(cur) ? [cur, ...options] : options
    return (
      <select
        className="db-cell-input"
        autoFocus
        value={cur}
        onChange={(e) => {
          commit(e.target.value)
          done()
        }}
        onBlur={done}
      >
        <option value="">—</option>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (type === 'date') {
    // A typable text field (not a native date picker) so you can enter "01 03 2018"
    // and have it normalised to YYYY-MM-DD; commit on blur, not on each keystroke.
    const cur = typeof v === 'string' ? v : ''
    return (
      <input
        className="db-cell-input"
        type="text"
        autoFocus
        defaultValue={cur}
        placeholder="YYYY-MM-DD"
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            cancel.current = true
            e.currentTarget.blur()
          }
        }}
        onBlur={(e) => {
          if (cancel.current) cancel.current = false
          else commit(parseLooseDate(e.currentTarget.value))
          done()
        }}
      />
    )
  }
  // number / list / text
  const display = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v)
  const coerce = (s: string): unknown => {
    if (type === 'number') {
      const n = Number(s)
      return Number.isFinite(n) ? n : 0
    }
    if (type === 'list') return s.split(',').map((x) => x.trim()).filter(Boolean)
    return s
  }
  return (
    <input
      className="db-cell-input"
      type={type === 'number' ? 'number' : 'text'}
      autoFocus
      defaultValue={display}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          cancel.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        if (cancel.current) cancel.current = false
        else commit(coerce(e.currentTarget.value))
        done()
      }}
    />
  )
}

function numericValues(rows: Row[], key: string): number[] {
  const out: number[] = []
  for (const r of rows) {
    const v = cellValue(r, key)
    if (v === '' || v === undefined || v === null) continue
    const n = Number(v)
    if (!Number.isNaN(n)) out.push(n)
  }
  return out
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')

function aggValue(rows: Row[], key: string, kind: AggKind): string {
  if (kind === 'none') return ''
  if (kind === 'count') {
    return fmtInt(rows.filter((r) => {
      const v = cellValue(r, key)
      return v !== '' && v !== undefined && v !== null
    }).length)
  }
  const nums = numericValues(rows, key)
  if (!nums.length) return '—'
  let r: number
  if (kind === 'sum') r = nums.reduce((a, b) => a + b, 0)
  else if (kind === 'avg') r = nums.reduce((a, b) => a + b, 0) / nums.length
  else if (kind === 'min') r = Math.min(...nums)
  else r = Math.max(...nums)
  return fmtInt(r)
}

export const label = (k: string): string => (k === 'backlinks' ? 'Backlinks' : k.charAt(0).toUpperCase() + k.slice(1))

/** Filter + sort a base's rows (no limit/grouping). Shared by the Bases page and embeds. */
export function baseRows(base: Base, parsed: Record<string, ParsedNote>, index: VaultIndex): Row[] {
  const rows = Object.values(parsed)
    .filter((n) => !base.folder || n.path === base.folder || n.path.startsWith(base.folder + '/'))
    .filter((n) => !base.tag || n.tags.includes(base.tag))
    .map((n) => ({ path: n.path, name: n.name, tags: n.tags, backlinks: index.backlinkCount(n.path), fm: n.frontmatter }))
    .filter((r) => base.filters.every((f) => passesFilter(cellValue(r, f.key), f)))
  rows.sort((a, b) => {
    const av = cellValue(a, base.sortKey)
    const bv = cellValue(b, base.sortKey)
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))
    return base.sortDir === 'asc' ? cmp : -cmp
  })
  return rows
}

function groupRows(rows: Row[], base: Base): { key: string; rows: Row[] }[] {
  if (!base.groupKey) return [{ key: '', rows }]
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    const k = String(cellValue(r, base.groupKey) ?? '—') || '—'
    map.set(k, [...(map.get(k) ?? []), r])
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => ({ key, rows }))
}

/**
 * Renders a base's rows as a table or gallery — the single source of truth shared by
 * the Bases page and inline `{{base …}}` embeds. Pass `onPatch` to make headers
 * sortable and footer aggregates editable (the Bases page); omit it for a read-only
 * embed. `limit` caps the visible rows (taken after the base's own sort).
 */
export function BaseView({
  base,
  openNote,
  openInSide,
  limit,
  onPatch
}: {
  base: Base
  openNote: (path: string) => void
  /** ⌘/Ctrl-click opens the note here (a side pane) instead of replacing the main view. */
  openInSide?: (path: string) => void
  limit?: number
  onPatch?: (p: Partial<Base>) => void
}): React.JSX.Element {
  const parsed = useStore((s) => s.parsed)
  const index = useStore((s) => s.index)
  const setNoteProperties = useStore((s) => s.setNoteProperties)
  const interactive = !!onPatch
  const cols = base.columns
  const [dragOver, setDragOver] = useState<string | null>(null)
  // ⌘/Ctrl-click a note → side pane; plain click → main view.
  const open = (e: { metaKey: boolean; ctrlKey: boolean }, path: string): void =>
    (e.metaKey || e.ctrlKey) && openInSide ? openInSide(path) : openNote(path)

  const all = useMemo(() => baseRows(base, parsed, index), [base, parsed, index])
  const visible = limit && limit > 0 ? all.slice(0, limit) : all
  const groups = useMemo(() => groupRows(visible, base), [visible, base])

  // Board: only a real frontmatter field can be reassigned by dragging a card.
  const BUILTIN_KEYS = ['name', 'backlinks', 'tags', 'cover']
  // Resolve each editable column's type/options once (from all rows) for consistent inline edits.
  const colMeta = useMemo(() => {
    const meta: Record<string, { type: PropType; options: string[] }> = {}
    if (interactive)
      for (const c of cols)
        if (!BUILTIN_KEYS.includes(c)) meta[c] = { type: columnType(all, c), options: columnOptions(all, c) }
    return meta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, cols, interactive])
  const canDragBoard = interactive && !!base.groupKey && !BUILTIN_KEYS.includes(base.groupKey)
  const moveCardToColumn = (row: Row, columnKey: string): void => {
    if (!canDragBoard) return
    const next = { ...row.fm }
    if (columnKey === '—' || columnKey === '') delete next[base.groupKey]
    else next[base.groupKey] = columnKey
    void setNoteProperties(row.path, next)
  }

  const toggleSort = (key: string): void => {
    if (!onPatch) return
    if (key === base.sortKey) onPatch({ sortDir: base.sortDir === 'asc' ? 'desc' : 'asc' })
    else onPatch({ sortKey: key, sortDir: 'asc' })
  }
  const setAgg = (key: string, kind: AggKind): void => onPatch?.({ aggregates: { ...base.aggregates, [key]: kind } })

  const hasAgg = Object.values(base.aggregates).some((a) => a && a !== 'none')
  const showFooter = visible.length > 0 && (interactive || hasAgg)

  const renderGallery = (rs: Row[]): React.JSX.Element => (
    <div className="base-gallery">
      {rs.map((row) => {
        const cover = cellValue(row, 'cover')
        const fields = cols.filter((c) => c !== 'name' && c !== 'cover')
        return (
          <div
            className="gallery-card"
            key={row.path}
            role="link"
            tabIndex={0}
            onClick={(e) => open(e, row.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                open(e, row.path)
              }
            }}
          >
            <div className="gallery-cover">
              {typeof cover === 'string' ? <img src={assetUrl(cover)} alt="" loading="lazy" /> : <div className="gallery-noimg">{row.name[0] ?? '?'}</div>}
            </div>
            <div className="gallery-title">{row.name}</div>
            {fields.map((c) => (
              <div className="gallery-meta" key={c}>
                {renderCell(row, c)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )

  const renderBoard = (): React.JSX.Element => {
    const fields = cols.filter((c) => c !== 'name' && c !== 'cover' && c !== base.groupKey)
    return (
      <div className="base-board">
        {groups.map((g) => (
          <div
            className={'board-col' + (dragOver === g.key ? ' drop-target' : '')}
            key={g.key}
            onDragOver={(e) => {
              if (canDragBoard) {
                e.preventDefault()
                setDragOver(g.key)
              }
            }}
            onDragLeave={() => setDragOver((k) => (k === g.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(null)
              const p = e.dataTransfer.getData('text/path')
              const r = all.find((x) => x.path === p)
              if (r) moveCardToColumn(r, g.key)
            }}
          >
            <div className="board-col-head">
              {g.key} <span className="todo-count">{g.rows.length}</span>
            </div>
            <div className="board-col-body">
              {g.rows.map((row) => {
                const cover = cellValue(row, 'cover')
                return (
                  <div
                    className="board-card"
                    key={row.path}
                    draggable={canDragBoard}
                    onDragStart={(e) => e.dataTransfer.setData('text/path', row.path)}
                    onClick={(e) => open(e, row.path)}
                  >
                    {typeof cover === 'string' && (
                      <img className="board-card-cover" src={assetUrl(cover)} alt="" loading="lazy" />
                    )}
                    <div className="board-card-title">{row.name}</div>
                    {fields.map((c) => (
                      <div className="board-card-meta" key={c}>
                        {renderCell(row, c)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (base.layout === 'board') {
    if (!base.groupKey)
      return <div className="db-empty">Click Edit and pick a “Group by” field — that field becomes the board’s columns.</div>
    if (visible.length === 0) return <div className="db-empty">No matching notes</div>
    return renderBoard()
  }

  if (base.layout === 'gallery') {
    if (visible.length === 0) return <div className="db-empty">No matching notes</div>
    if (base.groupKey)
      return (
        <>
          {groups.map((g) => (
            <div key={g.key} className="base-group">
              <div className="base-group-head">{g.key} <span className="todo-count">{g.rows.length}</span></div>
              {renderGallery(g.rows)}
            </div>
          ))}
        </>
      )
    return renderGallery(visible)
  }

  return (
    <div className="db-view">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} onClick={interactive ? () => toggleSort(c) : undefined} className={interactive ? 'sortable' : undefined}>
                {label(c)}
                {base.sortKey === c ? (base.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={'grp:' + g.key}>
              {base.groupKey && (
                <tr className="db-group">
                  <td colSpan={Math.max(1, cols.length)}>
                    {g.key} <span className="todo-count">{g.rows.length}</span>
                  </td>
                </tr>
              )}
              {g.rows.map((row) => (
                <tr key={row.path}>
                  {cols.map((c) => {
                    const meta = colMeta[c]
                    return (
                      <td
                        key={c}
                        className={c === 'name' ? 'title' : undefined}
                        role={c === 'name' ? 'link' : undefined}
                        tabIndex={c === 'name' ? 0 : undefined}
                        onClick={c === 'name' ? (e) => open(e, row.path) : undefined}
                        onKeyDown={
                          c === 'name'
                            ? (e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  open(e, row.path)
                                }
                              }
                            : undefined
                        }
                      >
                        {meta ? (
                          <EditableDataCell row={row} col={c} type={meta.type} options={meta.options} />
                        ) : (
                          renderCell(row, c)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
          {visible.length === 0 && (
            <tr>
              <td className="db-empty" colSpan={Math.max(1, cols.length)}>No matching notes</td>
            </tr>
          )}
        </tbody>
        {showFooter && (
          <tfoot>
            <tr className="db-agg">
              {cols.map((c, i) => {
                const kind = base.aggregates[c] ?? 'none'
                const val = aggValue(visible, c, kind)
                return (
                  <td key={c} className="db-agg-cell">
                    {val && <span className="db-agg-val">{val}</span>}
                    {interactive && (
                      <select
                        className="db-agg-select"
                        value={kind}
                        title={i === 0 ? 'Column total' : undefined}
                        onChange={(e) => setAgg(c, e.target.value as AggKind)}
                      >
                        {AGGS.map((a) => (
                          <option key={a.kind} value={a.kind}>{a.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Parse the args of `{{base <name> [limit:N] [layout:table|gallery]}}`. */
function parseBaseArgs(raw: string): { name: string; limit?: number; layout?: 'table' | 'gallery' | 'board' } {
  const nameParts: string[] = []
  let limit: number | undefined
  let layout: 'table' | 'gallery' | 'board' | undefined
  for (const tok of raw.trim().split(/\s+/)) {
    const m = tok.match(/^(\w+):(.+)$/)
    if (m && m[1].toLowerCase() === 'limit') {
      const n = parseInt(m[2], 10)
      if (n > 0) limit = n
    } else if (m && m[1].toLowerCase() === 'layout' && (m[2] === 'table' || m[2] === 'gallery' || m[2] === 'board')) {
      layout = m[2]
    } else if (!m) {
      nameParts.push(tok)
    }
  }
  return { name: nameParts.join(' '), limit, layout }
}

/** Inline `{{base …}}` embed: a read-only slice of a saved base, rendered like the Bases page. */
export function BaseEmbed({ raw }: { raw: string }): React.JSX.Element {
  const bases = useStore((s) => s.bases)
  const openNote = useStore((s) => s.openNote)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const openBase = useStore((s) => s.openBase)
  const openView = useStore((s) => s.openView)
  const { name, limit, layout } = parseBaseArgs(raw)

  const base = bases.find((b) => b.name.toLowerCase() === name.toLowerCase())
  if (!base) {
    return (
      <div className="base-embed base-embed-missing">
        Base “{name || '?'}” not found. Create it on the{' '}
        <span className="base-embed-link" onClick={() => openView('database')}>Bases</span> page.
      </div>
    )
  }
  const effective = layout ? { ...base, layout } : base
  return (
    <div className="base-embed">
      <div className="base-embed-head">
        <span className="base-embed-name" onClick={() => openBase(base.id)} title="Open this base">
          ▦ {base.name}
        </span>
        {limit ? <span className="base-embed-sub">top {limit}</span> : null}
      </div>
      <BaseView base={effective} openNote={openNote} openInSide={openInSidePane} limit={limit} />
    </div>
  )
}
