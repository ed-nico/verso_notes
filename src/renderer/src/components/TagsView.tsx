import { useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  buildSupertagIndex,
  FIELD_TYPES,
  normTag,
  resolveFields,
  supertagsFromParsed,
  type FieldDef,
  type FieldType,
  type Supertag
} from '../lib/supertags'

/** Format a frontmatter value for an instance-table cell. */
function fmtCell(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (typeof v === 'string') return v.replace(/^\[\[|\]\]$/g, '')
  return String(v)
}

/** Edit a supertag's own field schema (add/remove fields, change type, select options). */
function SupertagEditor({ st, index }: { st: Supertag; index: Map<string, Supertag> }): React.JSX.Element {
  const setSupertagFields = useStore((s) => s.setSupertagFields)
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')

  const resolved = resolveFields(st.tag, index)
  const ownNames = new Set(st.fields.map((f) => f.name))
  const inherited = resolved.filter((f) => !ownNames.has(f.name))

  const save = (fields: FieldDef[]): void => void setSupertagFields(st.path, fields)
  const addField = (): void => {
    const n = name.trim()
    if (!n || st.fields.some((f) => f.name === n)) return
    save([...st.fields, { name: n, type, options: type === 'select' ? [] : undefined }])
    setName('')
    setType('text')
  }
  const updateField = (i: number, patch: Partial<FieldDef>): void =>
    save(st.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)))
  const removeField = (i: number): void => save(st.fields.filter((_, k) => k !== i))

  return (
    <div className="st-editor">
      <div className="st-editor-head">
        Schema
        {st.extends.length > 0 && <span className="st-extends">inherits {st.extends.join(', ')}</span>}
      </div>

      {inherited.map((f) => (
        <div className="st-field inherited" key={'inh:' + f.name}>
          <span className="st-field-name">{f.name}</span>
          <span className="st-field-type">{f.type}</span>
          <span className="st-field-from">inherited</span>
        </div>
      ))}

      {st.fields.map((f, i) => (
        <div className="st-field" key={f.name}>
          <span className="st-field-name">{f.name}</span>
          <select
            className="st-field-type-sel"
            value={f.type}
            onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {f.type === 'select' && (
            <input
              className="st-field-opts"
              defaultValue={(f.options ?? []).join(', ')}
              placeholder="option, option…"
              onBlur={(e) =>
                updateField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
            />
          )}
          <button className="st-field-del" title="Remove field" onClick={() => removeField(i)}>
            ✕
          </button>
        </div>
      ))}

      <div className="st-field-add">
        <input
          className="st-field-name-in"
          value={name}
          placeholder="field name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addField()}
        />
        <select className="st-field-type-sel" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="st-field-addbtn" onClick={addField}>
          ＋ Add field
        </button>
      </div>
    </div>
  )
}

export function TagsView(): React.JSX.Element {
  const parsed = useStore((s) => s.parsed)
  const activeTag = useStore((s) => s.activeTag)
  const openTag = useStore((s) => s.openTag)
  const openNote = useStore((s) => s.openNote)
  const createSupertag = useStore((s) => s.createSupertag)
  const [creating, setCreating] = useState(false)

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of Object.values(parsed)) {
      for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [parsed])

  const stIndex = useMemo(() => buildSupertagIndex(supertagsFromParsed(parsed)), [parsed])
  const isSupertag = (tag: string): boolean => stIndex.has(normTag(tag))
  const activeSupertag = activeTag ? stIndex.get(normTag(activeTag)) : undefined

  const notes = useMemo(() => {
    if (!activeTag) return []
    const want = normTag(activeTag)
    return Object.values(parsed)
      .filter((n) => n.tags.some((t) => normTag(t) === want))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [parsed, activeTag])

  // Columns for the instance table = the supertag's resolved fields.
  const fields = activeSupertag ? resolveFields(activeSupertag.tag, stIndex) : []

  return (
    <div className="scroll-area">
      <div className="doc tags-doc">
        <h1>Tags</h1>
        <div className="tag-cloud">
          <button className={'tag-chip' + (activeTag === null ? ' active' : '')} onClick={() => openTag(null)}>
            All
          </button>
          {tags.map(([tag, count]) => (
            <button
              key={tag}
              className={'tag-chip' + (activeTag === tag ? ' active' : '') + (isSupertag(tag) ? ' supertag' : '')}
              onClick={() => openTag(tag)}
            >
              {isSupertag(tag) ? '▤ ' : '#'}
              {tag} <span className="tag-chip-count">{count}</span>
            </button>
          ))}
          {creating ? (
            <input
              className="tag-new-input"
              autoFocus
              placeholder="supertag name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void createSupertag(e.currentTarget.value)
                  setCreating(false)
                } else if (e.key === 'Escape') setCreating(false)
              }}
              onBlur={() => setCreating(false)}
            />
          ) : (
            <button className="tag-chip tag-new" onClick={() => setCreating(true)} title="Create a supertag (typed tag)">
              ＋ Supertag
            </button>
          )}
        </div>

        {activeSupertag && <SupertagEditor st={activeSupertag} index={stIndex} />}

        {activeTag && (
          <div className="tag-notes">
            <h3 className="tag-notes-head">
              {activeSupertag ? '▤ ' : '#'}
              {activeTag} <span className="todo-count">{notes.length}</span>
            </h3>

            {activeSupertag && fields.length > 0 ? (
              <table className="st-instances">
                <thead>
                  <tr>
                    <th>Name</th>
                    {fields.map((f) => (
                      <th key={f.name}>{f.name.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {notes.map((n) => (
                    <tr key={n.path} onClick={() => openNote(n.path)} title={n.path}>
                      <td className="st-cell-name">{n.name}</td>
                      {fields.map((f) => (
                        <td key={f.name}>{fmtCell(n.frontmatter[f.name])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              notes.map((n) => (
                <div key={n.path} className="tag-note" onClick={() => openNote(n.path)} title={n.path}>
                  <div className="tag-note-name">{n.name}</div>
                  {n.excerpt && <div className="tag-note-excerpt">{n.excerpt}</div>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
