import { useMemo } from 'react'
import { useStore } from '../store'
import { getFrontmatter } from '../lib/frontmatter'
import { buildSupertagIndex, fieldsForNote, supertagsForNote, supertagsFromParsed } from '../lib/supertags'
import { ValueEditor } from './PropertiesPanel'

/**
 * The inline expansion of a typed entity (e.g. clicking `Tilsa` in a note). Shows
 * the entity's supertag(s) and its schema fields, editable in place — edits write
 * to the entity note's frontmatter, the host note stays open.
 */
export function EntityCard({ path, onClose }: { path: string; onClose: () => void }): React.JSX.Element {
  const text = useStore((s) => s.texts[path] ?? '')
  const tags = useStore((s) => s.parsed[path]?.tags ?? [])
  const name = useStore((s) => s.parsed[path]?.name ?? path.replace(/\.md$/i, ''))
  const parsed = useStore((s) => s.parsed)
  const setNoteProperties = useStore((s) => s.setNoteProperties)
  const openNote = useStore((s) => s.openNote)
  const ensureDailyNote = useStore((s) => s.ensureDailyNote)
  const navigate = useStore((s) => s.navigate)

  const data = useMemo(() => getFrontmatter(text), [text])
  const stIndex = useMemo(() => buildSupertagIndex(supertagsFromParsed(parsed)), [parsed])
  const supertags = supertagsForNote(tags, stIndex)
  const fields = fieldsForNote(tags, stIndex)

  const update = (key: string, value: unknown): void => void setNoteProperties(path, { ...data, [key]: value })

  return (
    <div className="entity-card" onMouseDown={(e) => e.stopPropagation()}>
      <div className="entity-card-head">
        <button className="entity-card-title" onClick={() => openNote(path)} title="Open entity page">
          {name}
        </button>
        {supertags.map((s) => (
          <span className="entity-card-type" key={s.tag}>
            ▤ {s.name}
          </span>
        ))}
        <button className="entity-card-x" onClick={onClose} title="Collapse">
          ✕
        </button>
      </div>
      {fields.length === 0 ? (
        <div className="entity-card-empty">No fields defined. Add some on the supertag&rsquo;s page.</div>
      ) : (
        fields.map((f) => (
          <div className="entity-field" key={f.name}>
            <span className="entity-field-name">{f.name.replace(/_/g, ' ')}</span>
            <div className="entity-field-val">
              <ValueEditor
                type={f.type}
                value={data[f.name]}
                options={f.options}
                onCommit={(v) => update(f.name, v)}
                onOpenDate={(iso) => void ensureDailyNote(iso).then(openNote)}
                onOpenNote={(n) => void navigate(n)}
              />
            </div>
          </div>
        ))
      )}
    </div>
  )
}
