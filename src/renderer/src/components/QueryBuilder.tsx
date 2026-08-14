import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { parseQuery, type Atom, type QueryLayout, type QueryScope } from '../lib/query'
import { normTag } from '../lib/supertags'

/**
 * Visual builder for a `{{query …}}`.
 *
 * `/query` used to drop a bare `{{query }}` and leave you to guess the grammar.
 * This composes the same string by clicking, and shows the live match count as
 * you go — so the feedback loop is "does this find what I meant?", not "did I
 * remember the syntax?". The query text stays the source of truth: the builder
 * writes it, and anything typed by hand still works.
 *
 * It deliberately does NOT model the whole grammar (no OR groups, no negation
 * of arbitrary terms). Those stay available by hand; the builder covers the
 * cases people actually reach for, and hands you the text to refine.
 */

interface Cond {
  id: number
  kind: 'tag' | 'link' | 'text' | 'prop' | 'before' | 'after'
  value: string
  /** For prop: the optional `=value` half. */
  value2?: string
  negated: boolean
}

let seq = 1

/**
 * Turn a parsed query's atoms back into builder rows, so "Edit query" opens
 * showing the conditions rather than an empty form. Only a single AND-group is
 * representable — an OR query stays in the text box, where it already works.
 */
function condsFrom(atoms: Atom[]): { conds: Cond[]; task: '' | 'todo' | 'done' } {
  const conds: Cond[] = []
  let task: '' | 'todo' | 'done' = ''
  for (const a of atoms) {
    if (a.kind === 'task') {
      if (!a.negated) task = a.task ?? ''
      continue
    }
    const base = { id: seq++, negated: a.negated }
    if (a.kind === 'tag') conds.push({ ...base, kind: 'tag', value: a.value })
    else if (a.kind === 'link') conds.push({ ...base, kind: 'link', value: a.value })
    else if (a.kind === 'term') conds.push({ ...base, kind: 'text', value: a.value })
    else if (a.kind === 'prop')
      conds.push({ ...base, kind: 'prop', value: a.propKey ?? '', value2: a.propValue })
    else if (a.kind === 'date')
      conds.push({ ...base, kind: a.dateOp === 'before' ? 'before' : 'after', value: a.dateValue ?? '' })
  }
  return { conds, task }
}

const KIND_LABEL: Record<Cond['kind'], string> = {
  tag: 'Tag',
  link: 'Links to',
  text: 'Contains text',
  prop: 'Property',
  before: 'Before date',
  after: 'After date'
}

/** Build the query string from the builder's state. */
function compose(
  scope: QueryScope,
  conds: Cond[],
  task: '' | 'todo' | 'done',
  layout: QueryLayout,
  cols: string[],
  sortKey: string,
  sortDesc: boolean,
  limit: string,
  groupBy: string
): string {
  const parts: string[] = []
  for (const c of conds) {
    const v = c.value.trim()
    if (!v) continue
    const neg = c.negated ? '-' : ''
    if (c.kind === 'tag') parts.push(`${neg}#${normTag(v)}`)
    else if (c.kind === 'link') parts.push(`${neg}[[${v}]]`)
    else if (c.kind === 'text') parts.push(`${neg}${v.split(/\s+/).join(' ')}`)
    else if (c.kind === 'prop')
      parts.push(`${neg}prop:${v}${c.value2?.trim() ? `=${c.value2.trim()}` : ''}`)
    else parts.push(`${neg}${c.kind}:${v}`)
  }
  if (task) parts.push(task)
  if (scope === 'notes') parts.push('scope:notes')
  if (sortKey) parts.push(`sort:${sortDesc ? '-' : ''}${sortKey}`)
  if (groupBy) parts.push(`group:${groupBy}`)
  const n = Number(limit)
  if (Number.isFinite(n) && n >= 1) parts.push(`limit:${Math.floor(n)}`)
  // Only emit a layout that isn't the default for this scope, so the query stays
  // as short as what a person would have written.
  const dflt = scope === 'notes' ? 'table' : 'list'
  if (layout !== dflt) parts.push(`as:${layout}`)
  if (scope === 'notes' && cols.length) parts.push(`cols:${cols.join(',')}`)
  return parts.join(' ')
}

export function QueryBuilder({
  initial,
  onCancel,
  onApply
}: {
  /** Existing query text when editing, or '' for a new one. */
  initial: string
  onCancel: () => void
  onApply: (query: string) => void
}): React.JSX.Element {
  const index = useStore((s) => s.index)
  const parsed = useStore((s) => s.parsed)

  const spec0 = useMemo(() => parseQuery(initial), [initial])
  const seed = useMemo(() => condsFrom(spec0.groups[0]?.atoms ?? []), [spec0])
  const [scope, setScope] = useState<QueryScope>(spec0.scope)
  const [conds, setConds] = useState<Cond[]>(seed.conds)
  const [task, setTask] = useState<'' | 'todo' | 'done'>(seed.task)
  const [layout, setLayout] = useState<QueryLayout>(spec0.layout)
  const [cols, setCols] = useState<string[]>(spec0.cols ?? [])
  const [sortKey, setSortKey] = useState(spec0.sort ? String(spec0.sort.key) : '')
  const [sortDesc, setSortDesc] = useState(spec0.sort ? spec0.sort.dir === 'desc' : true)
  const [limit, setLimit] = useState(spec0.limit ? String(spec0.limit) : '')
  const [groupBy, setGroupBy] = useState(spec0.groupBy ?? '')
  /** Hand-edited text takes over: once you type here the builder stops composing.
   *  An OR query starts here too — the builder can't represent it, and silently
   *  dropping half the query on Update would be worse than not offering to. */
  const [manual, setManual] = useState<string | null>(spec0.groups.length > 1 ? initial.trim() : null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const composed = compose(scope, conds, task, layout, cols, sortKey, sortDesc, limit, groupBy)
  const query = manual ?? composed

  // Every tag and every frontmatter key in the vault, to offer as choices —
  // guessing a property name that doesn't exist is the main way a query
  // silently returns nothing.
  const { allTags, allProps } = useMemo(() => {
    const tags = new Set<string>()
    const props = new Set<string>()
    for (const n of Object.values(parsed)) {
      for (const t of n.tags) tags.add(normTag(t))
      for (const k of Object.keys(n.frontmatter)) if (!k.startsWith('_')) props.add(k)
    }
    return { allTags: [...tags].sort(), allProps: [...props].sort() }
  }, [parsed])

  const result = useMemo(() => (query.trim() ? index.runQuery(query) : null), [index, query])
  const count = result ? (result.notes ?? result.blocks).length : 0
  const total = result?.total ?? 0

  const add = (kind: Cond['kind']): void =>
    setConds((c) => [...c, { id: seq++, kind, value: '', negated: false }])
  const patch = (id: number, p: Partial<Cond>): void =>
    setConds((c) => c.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const drop = (id: number): void => setConds((c) => c.filter((x) => x.id !== id))

  const toggleCol = (c: string): void =>
    setCols((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal qb-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{initial.trim() ? 'Edit query' : 'New query'}</span>
          <button className="icon-btn" onClick={onCancel} title="Close">
            ✕
          </button>
        </div>

        <div className="qb-body">
          <div className="qb-row">
            <span className="qb-label">Find</span>
            <div className="seg">
              <button
                className={'seg-btn' + (scope === 'blocks' ? ' active' : '')}
                onClick={() => { setScope('blocks'); setManual(null) }}
              >
                Lines
              </button>
              <button
                className={'seg-btn' + (scope === 'notes' ? ' active' : '')}
                onClick={() => { setScope('notes'); setManual(null) }}
              >
                Notes
              </button>
            </div>
            <span className="qb-hint">
              {scope === 'blocks'
                ? 'Individual lines from across the vault — todos, bullets, any text.'
                : 'Whole notes as rows, with their properties as columns.'}
            </span>
          </div>

          <div className="qb-row">
            <span className="qb-label">Where</span>
            <div className="qb-conds">
              {conds.map((c) => (
                <div className="qb-cond" key={c.id}>
                  <button
                    className={'qb-not' + (c.negated ? ' on' : '')}
                    title={c.negated ? 'Excluding' : 'Including — click to exclude'}
                    onClick={() => { patch(c.id, { negated: !c.negated }); setManual(null) }}
                  >
                    {c.negated ? 'not' : 'is'}
                  </button>
                  <span className="qb-cond-kind">{KIND_LABEL[c.kind]}</span>
                  {c.kind === 'tag' ? (
                    <select
                      className="qb-input"
                      value={c.value}
                      onChange={(e) => { patch(c.id, { value: e.target.value }); setManual(null) }}
                    >
                      <option value="">choose a tag…</option>
                      {allTags.map((t) => (
                        <option key={t} value={t}>
                          #{t}
                        </option>
                      ))}
                    </select>
                  ) : c.kind === 'prop' ? (
                    <>
                      <select
                        className="qb-input"
                        value={c.value}
                        onChange={(e) => { patch(c.id, { value: e.target.value }); setManual(null) }}
                      >
                        <option value="">choose a property…</option>
                        {allProps.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        className="qb-input"
                        placeholder="= value (optional)"
                        value={c.value2 ?? ''}
                        onChange={(e) => { patch(c.id, { value2: e.target.value }); setManual(null) }}
                      />
                    </>
                  ) : (
                    <input
                      className="qb-input"
                      placeholder={
                        c.kind === 'link' ? 'Page name' : c.kind === 'text' ? 'word or phrase' : 'YYYY-MM-DD'
                      }
                      value={c.value}
                      onChange={(e) => { patch(c.id, { value: e.target.value }); setManual(null) }}
                    />
                  )}
                  <button className="qb-del" title="Remove" onClick={() => { drop(c.id); setManual(null) }}>
                    ✕
                  </button>
                </div>
              ))}
              <div className="qb-add">
                {(['tag', 'link', 'text', 'prop', 'before', 'after'] as const).map((k) => (
                  <button key={k} className="qb-addbtn" onClick={() => { add(k); setManual(null) }}>
                    ＋ {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <div className="qb-hint">All conditions must match (AND).</div>
            </div>
          </div>

          <div className="qb-row">
            <span className="qb-label">Tasks</span>
            <div className="seg">
              {(['', 'todo', 'done'] as const).map((t) => (
                <button
                  key={t || 'any'}
                  className={'seg-btn' + (task === t ? ' active' : '')}
                  onClick={() => { setTask(t); setManual(null) }}
                >
                  {t === '' ? 'Any' : t === 'todo' ? 'Open only' : 'Done only'}
                </button>
              ))}
            </div>
          </div>

          <div className="qb-row">
            <span className="qb-label">Show as</span>
            <div className="seg">
              {(scope === 'notes' ? (['table', 'gallery'] as const) : (['list', 'table'] as const)).map((l) => (
                <button
                  key={l}
                  className={'seg-btn' + (layout === l ? ' active' : '')}
                  onClick={() => { setLayout(l); setManual(null) }}
                >
                  {l[0].toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {scope === 'notes' && (
            <div className="qb-row">
              <span className="qb-label">Columns</span>
              <div className="qb-cols">
                {[...new Set(['name', 'tags', 'date', 'status', 'excerpt', ...allProps])].map((c) => (
                  <button
                    key={c}
                    className={'qb-col' + (cols.includes(c) ? ' on' : '')}
                    onClick={() => { toggleCol(c); setManual(null) }}
                  >
                    {c}
                  </button>
                ))}
                {!cols.length && <span className="qb-hint">None picked — defaults to name, tags, date.</span>}
              </div>
            </div>
          )}

          <div className="qb-row">
            <span className="qb-label">Order</span>
            <select
              className="qb-input"
              value={sortKey}
              onChange={(e) => { setSortKey(e.target.value); setManual(null) }}
            >
              <option value="">vault order</option>
              {['date', 'name', 'path', 'text', 'status', ...(scope === 'notes' ? allProps : [])].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {sortKey && (
              <div className="seg">
                <button className={'seg-btn' + (sortDesc ? ' active' : '')} onClick={() => { setSortDesc(true); setManual(null) }}>
                  ↓ Desc
                </button>
                <button className={'seg-btn' + (!sortDesc ? ' active' : '')} onClick={() => { setSortDesc(false); setManual(null) }}>
                  ↑ Asc
                </button>
              </div>
            )}
            <span className="qb-label qb-label-sm">Limit</span>
            <input
              className="qb-input qb-input-sm"
              placeholder="all"
              value={limit}
              onChange={(e) => { setLimit(e.target.value); setManual(null) }}
            />
            <span className="qb-label qb-label-sm">Group</span>
            <select
              className="qb-input qb-input-sm"
              value={groupBy}
              onChange={(e) => { setGroupBy(e.target.value); setManual(null) }}
            >
              <option value="">none</option>
              {['note', 'tag', 'date', 'status'].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          <div className="qb-preview">
            <div className="qb-preview-head">
              <span>Query</span>
              <span className={'qb-count' + (query.trim() && total === 0 ? ' zero' : '')}>
                {!query.trim()
                  ? 'add a condition'
                  : total === 0
                    ? 'matches nothing'
                    : `${count === total ? total : `${count} of ${total}`} ${
                        scope === 'notes' ? 'note' : 'line'
                      }${total === 1 ? '' : 's'}`}
              </span>
            </div>
            {/* Editable: the text is the source of truth, and hand-tuning it
                (OR groups, anything the builder doesn't model) must stay possible. */}
            <textarea
              className="qb-text"
              rows={2}
              value={query}
              placeholder="{{query …}} — or build one above"
              onChange={(e) => setManual(e.target.value)}
            />
            {manual !== null && (
              <button className="qb-reset" onClick={() => setManual(null)}>
                ↺ back to the builder
              </button>
            )}
          </div>
        </div>

        <div className="qb-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!query.trim()} onClick={() => onApply(query.trim())}>
            {initial.trim() ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  )
}
