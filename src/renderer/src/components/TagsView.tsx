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
import { VaultLoadingNote } from './VaultLoading'

/** Format a frontmatter value for an instance-table cell. */
function fmtCell(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (typeof v === 'string') return v.replace(/^\[\[|\]\]$/g, '')
  return String(v)
}

/**
 * A tag's field schema. Shown for EVERY tag, not only ones that already have a
 * definition note: adding the first field is what mints `Tags/<tag>.md`. That's
 * the whole "one concept" bargain — a tag is a cheap gesture, and it only costs
 * a file once you give it structure. `st` is undefined until then.
 */
function SchemaEditor({
  tag,
  st,
  index,
  instances
}: {
  tag: string
  st: Supertag | undefined
  index: Map<string, Supertag>
  /** How many notes carry this tag — decides what removing the schema costs. */
  instances: number
}): React.JSX.Element {
  const setSupertagFields = useStore((s) => s.setSupertagFields)
  const createSupertag = useStore((s) => s.createSupertag)
  const removeSupertag = useStore((s) => s.removeSupertag)
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')

  const own = st?.fields ?? []
  const resolved = st ? resolveFields(st.tag, index) : []
  const ownNames = new Set(own.map((f) => f.name))
  const inherited = resolved.filter((f) => !ownNames.has(f.name))

  const save = (fields: FieldDef[]): void => {
    if (st) void setSupertagFields(st.path, fields)
  }
  const addField = (): void => {
    const n = name.trim()
    if (!n || own.some((f) => f.name === n)) return
    const next = [...own, { name: n, type, options: type === 'select' ? [] : undefined }]
    // No definition note yet → create it first, then write the schema to it.
    const write = st
      ? setSupertagFields(st.path, next)
      : createSupertag(tag, { open: false }).then((path) => (path ? setSupertagFields(path, next) : undefined))
    void write
    setName('')
    setType('text')
  }
  /** Delete the definition note. Spell out the consequence, which differs sharply:
   *  with no instances the tag disappears entirely; with instances it survives,
   *  untyped, and the field VALUES already in those notes stay as plain properties. */
  const removeSchema = (): void => {
    if (!st) return
    const msg =
      instances === 0
        ? `Remove the tag “${tag}”?\n\nNothing uses it, so it will be gone. ${st.path} goes to the Trash.`
        : `Remove the schema from “${tag}”?\n\n${st.path} goes to the Trash. The tag stays on ${instances} note${
            instances === 1 ? '' : 's'
          } as a plain tag, and any field values already saved in them are kept as ordinary properties.`
    if (window.confirm(msg)) void removeSupertag(tag)
  }
  const updateField = (i: number, patch: Partial<FieldDef>): void =>
    save(own.map((f, k) => (k === i ? { ...f, ...patch } : f)))
  const removeField = (i: number): void => save(own.filter((_, k) => k !== i))

  return (
    <div className="st-editor">
      <div className="st-editor-head">
        Schema
        {st && st.extends.length > 0 && <span className="st-extends">inherits {st.extends.join(', ')}</span>}
        {!st && <span className="st-extends">add a field to give this tag structure</span>}
        {st && (
          <button className="st-remove" onClick={removeSchema} title={`Delete ${st.path}`}>
            {instances === 0 ? 'Remove tag' : 'Remove schema'}
          </button>
        )}
      </div>

      {inherited.map((f) => (
        <div className="st-field inherited" key={'inh:' + f.name}>
          <span className="st-field-name">{f.name}</span>
          <span className="st-field-type">{f.type}</span>
          <span className="st-field-from">inherited</span>
        </div>
      ))}

      {own.map((f, i) => (
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

  const stIndex = useMemo(() => buildSupertagIndex(supertagsFromParsed(parsed)), [parsed])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of Object.values(parsed)) {
      for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    // A supertag exists because its note under Tags/ says so, NOT because a note
    // carries it — the definition note doesn't tag itself. Without this a freshly
    // created supertag is invisible here until something is tagged with it, which
    // is exactly when you most need to find it (to give it a schema).
    const seen = new Set([...counts.keys()].map(normTag))
    for (const tag of stIndex.keys()) if (!seen.has(tag)) counts.set(tag, 0)
    // Supertags first, then by use, then alphabetically — an unused supertag would
    // otherwise sink below every casual #tag.
    const rank = (t: string): number => (stIndex.has(normTag(t)) ? 0 : 1)
    return [...counts.entries()].sort(
      (a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0])
    )
  }, [parsed, stIndex])
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
        <VaultLoadingNote what="Tag counts are still climbing." />
        <h1>Tags</h1>
        {tags.length === 0 && (
          <p className="empty-note">
            No tags yet — add #tags to your notes (or create one below) and they&rsquo;ll gather here.
          </p>
        )}
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
              placeholder="tag name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Stay on this page and select the new tag, so its schema editor is
                  // right there. Opening the definition note instead (the default)
                  // landed you on a blank page with no way to add a field.
                  const name = e.currentTarget.value
                  void createSupertag(name, { open: false }).then(() => openTag(normTag(name)))
                  setCreating(false)
                } else if (e.key === 'Escape') setCreating(false)
              }}
              onBlur={() => setCreating(false)}
            />
          ) : (
            <button
              className="tag-chip tag-new"
              onClick={() => setCreating(true)}
              title="Create a tag up front (you can add fields to it)"
            >
              ＋ New tag
            </button>
          )}
        </div>

        {activeTag && (
          <SchemaEditor tag={activeTag} st={activeSupertag} index={stIndex} instances={notes.length} />
        )}

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
