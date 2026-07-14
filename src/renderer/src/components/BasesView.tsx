import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { newBase, type Base, type Filter, type FilterOp } from '../lib/bases'
import { BaseView, baseRows, cellValue, label } from './BaseView'

const BUILTINS = ['name', 'cover', 'tags', 'backlinks']
const OPS: FilterOp[] = ['contains', 'is', 'is not', '>', '<', '>=', '<=', 'exists', 'empty']

export function BasesView(): React.JSX.Element {
  const parsed = useStore((s) => s.parsed)
  const index = useStore((s) => s.index)
  const openNote = useStore((s) => s.openNote)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const bases = useStore((s) => s.bases)
  const activeId = useStore((s) => s.activeBaseId)
  const setBases = useStore((s) => s.setBases)
  const openBase = useStore((s) => s.openBase)
  const [editing, setEditing] = useState(false)

  const active = bases.find((b) => b.id === activeId) ?? null
  const patch = (p: Partial<Base>): void => {
    if (active) setBases(bases.map((b) => (b.id === active.id ? { ...b, ...p } : b)))
  }
  const create = (): void => {
    const b = newBase(`Base ${bases.length + 1}`)
    setBases([...bases, b])
    openBase(b.id)
    setEditing(true)
  }
  const remove = (id: string): void => {
    // Confirm like note/asset deletion does — a base can hold a lot of filter/
    // column config, and (unlike notes) there is no Trash to recover it from.
    const name = bases.find((b) => b.id === id)?.name ?? 'this base'
    if (!window.confirm(`Delete “${name}”? Its filters and columns can't be recovered.`)) return
    setBases(bases.filter((b) => b.id !== id))
    setEditing(false)
  }

  const folder = active?.folder ?? ''
  // Notes the base draws from — used so the property/tag pickers only offer what's
  // actually present in the selected folder (everything when no folder is chosen).
  const inFolder = (p: string): boolean => !folder || p === folder || p.startsWith(folder + '/')

  // Top-level folders only (selecting one still includes everything nested beneath it).
  const allFolders = useMemo(() => {
    const set = new Set<string>()
    for (const n of Object.values(parsed)) if (n.path.includes('/')) set.add(n.path.split('/')[0])
    return [...set].sort()
  }, [parsed])
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of Object.values(parsed)) if (inFolder(n.path)) n.tags.forEach((t) => set.add(t))
    return [...set].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, folder])
  const allFmKeys = useMemo(() => {
    const set = new Set<string>()
    for (const n of Object.values(parsed))
      if (inFolder(n.path)) for (const k of Object.keys(n.frontmatter)) if (!k.startsWith('_')) set.add(k)
    return [...set].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, folder])
  // Frontmatter keys excluding the built-in pseudo-columns, so e.g. a `tags:` property
  // doesn't render a second "Tags" option alongside the built-in one.
  const userFmKeys = allFmKeys.filter((k) => !BUILTINS.includes(k))
  const filterKeys = ['name', 'tags', 'backlinks', ...userFmKeys]
  const cols = active ? active.columns : []
  const groupable = cols.filter((c) => c !== 'cover')
  const hasAgg = active ? Object.values(active.aggregates).some((a) => a && a !== 'none') : false

  const toggleColumn = (key: string): void => {
    if (!active) return
    patch({ columns: active.columns.includes(key) ? active.columns.filter((c) => c !== key) : [...active.columns, key] })
  }
  const setFilter = (i: number, f: Filter): void => {
    if (active) patch({ filters: active.filters.map((x, j) => (j === i ? f : x)) })
  }
  const addFilter = (): void => {
    if (active) patch({ filters: [...active.filters, { key: filterKeys[0], op: 'contains', value: '' }] })
  }
  const delFilter = (i: number): void => {
    if (active) patch({ filters: active.filters.filter((_, j) => j !== i) })
  }

  const exportCsv = (): void => {
    if (!active) return
    const esc = (v: unknown): string => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csvCell = (r: { tags: string[]; path: string; name: string; backlinks: number; fm: Record<string, unknown> }, c: string): string =>
      c === 'tags' ? r.tags.map((t) => '#' + t).join('; ') : String(cellValue(r, c) ?? '')
    const header = active.columns.map(label).join(',')
    const lines = baseRows(active, parsed, index).map((r) => active.columns.map((c) => esc(csvCell(r, c))).join(','))
    const csv = [header, ...lines].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.name || 'base'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="scroll-area">
      <div className="bases">
        <div className="bases-bar">
          <div className="bases-tabs">
            {bases.map((b) => (
              <button
                key={b.id}
                className={'base-tab' + (b.id === activeId ? ' active' : '')}
                onClick={() => {
                  openBase(b.id)
                  setEditing(false)
                }}
              >
                {b.name}
              </button>
            ))}
            <button className="base-tab base-new" onClick={create} title="New base">
              ＋
            </button>
          </div>
          {active && (
            <div className="bases-actions">
              <div className="seg">
                <button className={'seg-btn' + (active.layout === 'table' ? ' active' : '')} onClick={() => patch({ layout: 'table' })}>
                  ▤ Table
                </button>
                <button className={'seg-btn' + (active.layout === 'gallery' ? ' active' : '')} onClick={() => patch({ layout: 'gallery' })}>
                  ▦ Gallery
                </button>
                <button className={'seg-btn' + (active.layout === 'board' ? ' active' : '')} onClick={() => patch({ layout: 'board' })}>
                  ▥ Board
                </button>
              </div>
              <button className="btn-sm" onClick={exportCsv} title="Export visible rows as CSV">
                ↓ CSV
              </button>
              <button className="btn-sm" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Done' : 'Edit'}
              </button>
              <button className="btn-sm danger" onClick={() => remove(active.id)}>
                Delete
              </button>
            </div>
          )}
        </div>

        {!active && (
          <div className="bases-empty">
            <p>Bases are saved views over your notes — filter by folder, tag or property, pick columns, group, total numeric columns, and show as a table or a gallery. Embed one in any note with <code>{'{{base Name limit:5}}'}</code>.</p>
            <button className="btn" onClick={create}>
              Create a base
            </button>
          </div>
        )}

        {active && editing && (
          <div className="base-config">
            <label className="base-field">
              <span>Name</span>
              <input className="prop-input" value={active.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="base-field">
              <span>Folder</span>
              <select className="prop-input" value={active.folder} onChange={(e) => patch({ folder: e.target.value })}>
                <option value="">All notes</option>
                {allFolders.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="base-field">
              <span>Tag</span>
              <select className="prop-input" value={active.tag} onChange={(e) => patch({ tag: e.target.value })}>
                <option value="">Any</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
            </label>
            <label className="base-field">
              <span>Group by</span>
              <select className="prop-input" value={active.groupKey} onChange={(e) => patch({ groupKey: e.target.value })}>
                <option value="">No grouping</option>
                {groupable.map((k) => (
                  <option key={k} value={k}>{label(k)}</option>
                ))}
              </select>
            </label>
            <div className="base-field base-cols-field">
              <span>Columns</span>
              <div className="base-cols">
                {[...BUILTINS, ...userFmKeys].map((k) => (
                  <label key={k} className="base-col-opt">
                    <input type="checkbox" checked={active.columns.includes(k)} onChange={() => toggleColumn(k)} />
                    {label(k)}
                  </label>
                ))}
              </div>
            </div>
            <div className="base-field base-filters">
              <span>Filters</span>
              {active.filters.map((f, i) => (
                <div className="base-filter-row" key={i}>
                  <select className="prop-input" value={f.key} onChange={(e) => setFilter(i, { ...f, key: e.target.value })}>
                    {filterKeys.map((k) => (
                      <option key={k} value={k}>{label(k)}</option>
                    ))}
                  </select>
                  <select className="prop-input" value={f.op} onChange={(e) => setFilter(i, { ...f, op: e.target.value as FilterOp })}>
                    {OPS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  {f.op !== 'exists' && f.op !== 'empty' && (
                    <input
                      className="prop-input"
                      placeholder="value"
                      value={f.value}
                      onChange={(e) => setFilter(i, { ...f, value: e.target.value })}
                    />
                  )}
                  <button className="prop-del" onClick={() => delFilter(i)} title="Remove filter">✕</button>
                </div>
              ))}
              <button className="prop-add" onClick={addFilter}>＋ Add filter</button>
            </div>
            <div className="props-hint">
              Totals: in the table, use the dropdown in each column's footer row to show a Sum, Average,
              Min, Max or Count.
            </div>
          </div>
        )}

        {active && <BaseView base={active} openNote={openNote} openInSide={openInSidePane} onPatch={patch} />}

        {active && active.layout === 'table' && !editing && !hasAgg && (
          <div className="props-hint base-agg-hint">Tip: pick Sum / Average / Min / Max in a column's footer to total it.</div>
        )}
      </div>
    </div>
  )
}
