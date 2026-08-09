import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { getFrontmatter, isSystemProp } from '../lib/frontmatter'
import { assetUrl } from '../lib/assets'
import { openLinkTarget } from '../lib/openLink'
import { parseLooseDate } from '../lib/dates'
import { resolveTarget } from '../lib/links'
import { ContextMenu } from './ContextMenu'
import { renderInline } from './InlineMarkdown'
import { SelectChip } from './SelectChip'
import { vaultPropSchemas, withOptions } from '../lib/propSchema'
import {
  OPTION_COLORS,
  optionColors,
  renameOption,
  seedColors,
  withOptionColors,
  type OptionColor
} from '../lib/propColors'
import {
  buildSupertagIndex,
  fieldsForNote,
  isSupertagSchemaKey,
  normTag,
  supertagsFromParsed,
  type FieldType
} from '../lib/supertags'

export type PropType = 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'select'

const PROP_TYPES: { value: PropType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'list', label: 'List' },
  { value: 'select', label: 'Select' }
]

const isDateStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Infer a property's type from the shape of its stored value. */
export function typeOf(v: unknown): PropType {
  if (typeof v === 'boolean') return 'checkbox'
  if (typeof v === 'number') return 'number'
  if (Array.isArray(v)) return 'list'
  if (isDateStr(v)) return 'date'
  return 'text'
}

/** A property's EXPLICIT `_types` choice for `fm[key]`, or null if it was never set. */
export function storedPropType(fm: Record<string, unknown>, key: string): PropType | null {
  const types =
    fm._types && typeof fm._types === 'object' && !Array.isArray(fm._types)
      ? (fm._types as Record<string, unknown>)
      : {}
  const t = types[key]
  return typeof t === 'string' && PROP_TYPES.some((p) => p.value === t) ? (t as PropType) : null
}

/** A property's effective type for `fm[key]`: an explicit `_types` choice, else inferred
 *  from the value. Shared with the Bases inline editor so both honour the same types. */
export function effectivePropType(fm: Record<string, unknown>, key: string): PropType {
  const types =
    fm._types && typeof fm._types === 'object' && !Array.isArray(fm._types)
      ? (fm._types as Record<string, unknown>)
      : {}
  const t = types[key]
  return typeof t === 'string' && PROP_TYPES.some((p) => p.value === t) ? (t as PropType) : typeOf(fm[key])
}

/** A Select property's options for `fm[key]`, from the hidden `_options` map. */
export function propOptions(fm: Record<string, unknown>, key: string): string[] {
  const o =
    fm._options && typeof fm._options === 'object' && !Array.isArray(fm._options)
      ? (fm._options as Record<string, unknown>)
      : {}
  return Array.isArray(o[key]) ? (o[key] as unknown[]).map(String) : []
}

/** Convert a value to the YAML shape for a chosen type. */
function coerceTo(v: unknown, t: PropType): unknown {
  switch (t) {
    case 'checkbox':
      return typeof v === 'boolean' ? v : v === 'true'
    case 'number': {
      const n = Number(Array.isArray(v) ? '' : v)
      return Number.isFinite(n) ? n : 0
    }
    case 'date':
      return isDateStr(v) ? v : ''
    case 'list':
      return Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    case 'select':
      // A single chosen string; an array collapses to its first entry.
      return Array.isArray(v) ? String(v[0] ?? '') : v === undefined || v === null ? '' : String(v)
    default:
      return Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v)
  }
}

/** A property value that points at an image (URL or local asset path). */
function imageValue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(v.trim()) ? v.trim() : null
}

/** A small monochrome icon for a property's type (à la Obsidian). */
function PropIcon({ type, name }: { type: PropType; name: string }): React.JSX.Element {
  const kind = name.toLowerCase() === 'tags' ? 'tags' : type
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'prop-icon'
  }
  switch (kind) {
    case 'number':
      return (
        <svg {...common}>
          <line x1="6.2" y1="2.5" x2="5" y2="13.5" />
          <line x1="11" y1="2.5" x2="9.8" y2="13.5" />
          <line x1="2.8" y1="6" x2="13" y2="6" />
          <line x1="2.4" y1="10" x2="12.6" y2="10" />
        </svg>
      )
    case 'date':
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
          <line x1="2.5" y1="6.5" x2="13.5" y2="6.5" />
          <line x1="5.5" y1="2" x2="5.5" y2="5" />
          <line x1="10.5" y1="2" x2="10.5" y2="5" />
        </svg>
      )
    case 'checkbox':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
          <path d="M5 8.2 L7 10.2 L11 5.8" />
        </svg>
      )
    case 'list':
      return (
        <svg {...common}>
          <line x1="6" y1="4.5" x2="13.5" y2="4.5" />
          <line x1="6" y1="8" x2="13.5" y2="8" />
          <line x1="6" y1="11.5" x2="13.5" y2="11.5" />
          <circle cx="3" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="3" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'select':
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
          <path d="M6 7 L8 9 L10 7" />
        </svg>
      )
    case 'tags':
      return (
        <svg {...common}>
          <path d="M2.5 8.2 L8 2.7 H13.3 V8 L7.8 13.5 Z" />
          <circle cx="10.4" cy="5.6" r="1" />
        </svg>
      )
    default: // text
      return (
        <svg {...common}>
          <line x1="2.7" y1="4.5" x2="13.3" y2="4.5" />
          <line x1="2.7" y1="8" x2="13.3" y2="8" />
          <line x1="2.7" y1="11.5" x2="9" y2="11.5" />
        </svg>
      )
  }
}

/** Opts for rendering a value's inline markdown (wikilinks/tags) as clickable chips. */
interface InlineOpts {
  isResolved: (raw: string) => boolean
  onNavigate: (raw: string, side?: boolean) => void
  onTag?: (t: string) => void
}

const WIKILINK_RE = /\[\[[^\]\n]+\]\]/

/** Read view for a value that contains `[[wikilinks]]`: renders them as clickable chips,
 *  with a ✎ button to switch to a raw-text input. Keeps frontmatter relationships
 *  navigable instead of showing `[[Name]]` as literal text. */
function LinkyValue({
  display,
  editValue,
  onCommitText,
  inline
}: {
  display: string
  editValue: string
  onCommitText: (text: string) => void
  inline: InlineOpts
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        className="prop-input"
        autoFocus
        defaultValue={editValue}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => {
          setEditing(false)
          if (e.currentTarget.value !== editValue) onCommitText(e.currentTarget.value)
        }}
      />
    )
  }
  return (
    <div className="prop-date">
      <div className="prop-linky">{renderInline(display, inline)}</div>
      <button className="prop-jump" title="Edit" onClick={() => setEditing(true)}>
        ✎
      </button>
    </div>
  )
}

/** A user-defined Select property: pick a value from a dropdown of coloured options
 *  the user manages inline (✎ toggles the options editor — rename, recolour, remove). */
function UserSelectEditor({
  value,
  options,
  colors,
  onCommit,
  onAddOption,
  onRenameOption,
  onRemoveOption,
  onSetColor
}: {
  value: unknown
  options: string[]
  colors: Record<string, OptionColor>
  onCommit: (v: string) => void
  onAddOption: (name: string) => void
  onRenameOption: (from: string, to: string) => void
  onRemoveOption: (name: string) => void
  onSetColor: (name: string, color: OptionColor) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(options.length === 0) // open straight to setup when empty
  const current = typeof value === 'string' ? value : ''
  if (editing) {
    return (
      <div className="opt-editor">
        {options.map((o) => (
          <div className="opt-row" key={o}>
            <input
              className="prop-input opt-name"
              defaultValue={o}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => {
                const to = e.currentTarget.value.trim()
                if (to && to !== o) onRenameOption(o, to)
                else e.currentTarget.value = o
              }}
            />
            <button className="prop-del opt-del" title="Remove option" onClick={() => onRemoveOption(o)}>
              ✕
            </button>
            <div className="opt-swatches">
              {OPTION_COLORS.map((c) => (
                <button
                  key={c}
                  className={'opt-sw' + (colors[o] === c ? ' on' : '')}
                  data-color={c}
                  title={c}
                  onClick={() => onSetColor(o, c)}
                />
              ))}
            </div>
          </div>
        ))}
        <input
          className="prop-input opt-add"
          autoFocus={options.length === 0}
          placeholder="add option…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = e.currentTarget.value.trim()
              if (v) onAddOption(v)
              e.currentTarget.value = ''
            } else if (e.key === 'Escape') setEditing(false)
          }}
        />
        <button className="prop-jump opt-done" title="Done editing options" onClick={() => setEditing(false)}>
          ✓ Done
        </button>
      </div>
    )
  }
  return (
    <div className="prop-date">
      <SelectChip value={current} options={options} colors={colors} onCommit={onCommit} />
      <button className="prop-jump" title="Edit options" onClick={() => setEditing(true)}>
        ✎
      </button>
    </div>
  )
}

/** Editor for one typed value. Handles the base property types plus the supertag-only
 *  `select` (needs `options`) and `link` (needs `onOpenNote`) field types. When `inline`
 *  is given, plain text/list values containing `[[wikilinks]]` render as clickable chips. */
export function ValueEditor({
  type,
  value,
  options,
  colors,
  onCommit,
  onOpenDate,
  onOpenNote,
  inline
}: {
  type: FieldType
  value: unknown
  options?: string[]
  colors?: Record<string, OptionColor>
  onCommit: (v: unknown) => void
  onOpenDate: (iso: string) => void
  onOpenNote?: (name: string) => void
  inline?: InlineOpts
}): React.JSX.Element {
  if (type === 'select') {
    return (
      <SelectChip
        value={typeof value === 'string' ? value : ''}
        options={options ?? []}
        colors={colors}
        onCommit={onCommit}
      />
    )
  }
  if (type === 'url') {
    const url = typeof value === 'string' ? value : ''
    return (
      <div className="prop-date">
        <input
          className="prop-input"
          type="url"
          defaultValue={url}
          placeholder="https://…"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => onCommit(e.target.value.trim())}
        />
        {url && (
          <button className="prop-jump" title="Open link" onClick={() => openLinkTarget(url)}>
            ↗
          </button>
        )}
      </div>
    )
  }
  if (type === 'link') {
    const name = typeof value === 'string' ? value.replace(/^\[\[|\]\]$/g, '') : ''
    return (
      <div className="prop-date">
        <input
          className="prop-input"
          defaultValue={name}
          placeholder="note name"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => onCommit(e.target.value.trim())}
        />
        {name && onOpenNote && (
          <button className="prop-jump" title="Open note" onClick={() => onOpenNote(name)}>
            ↗
          </button>
        )}
      </div>
    )
  }
  if (type === 'checkbox') {
    return <input type="checkbox" checked={value === true} onChange={(e) => onCommit(e.target.checked)} />
  }
  if (type === 'list') {
    const joined = Array.isArray(value) ? value.join(', ') : String(value ?? '')
    const commitList = (raw: string): void =>
      onCommit(raw.split(',').map((s) => s.trim()).filter(Boolean))
    if (inline && WIKILINK_RE.test(joined)) {
      return <LinkyValue display={joined} editValue={joined} onCommitText={commitList} inline={inline} />
    }
    return (
      <input
        className="prop-input"
        defaultValue={joined}
        placeholder="comma, separated"
        onBlur={(e) => commitList(e.target.value)}
      />
    )
  }
  if (type === 'number') {
    return (
      <input
        className="prop-input"
        type="number"
        defaultValue={typeof value === 'number' ? value : ''}
        onBlur={(e) => onCommit(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    )
  }
  if (type === 'date') {
    // Typable (not a native picker) so "01 03 2018" can be entered and normalised to ISO.
    const cur = typeof value === 'string' ? value : ''
    const iso = isDateStr(value) ? value : ''
    return (
      <div className="prop-date">
        <input
          className="prop-input"
          type="text"
          defaultValue={cur}
          placeholder="YYYY-MM-DD"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => onCommit(parseLooseDate(e.target.value))}
        />
        {iso && (
          <button className="prop-jump" title="Open journal entry" onClick={() => onOpenDate(iso)}>
            ↗
          </button>
        )}
      </div>
    )
  }
  const str = value === undefined || value === null ? '' : String(value)
  if (inline && WIKILINK_RE.test(str)) {
    return <LinkyValue display={str} editValue={str} onCommitText={onCommit} inline={inline} />
  }
  return (
    <input
      className="prop-input"
      defaultValue={str}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      onBlur={(e) => onCommit(e.target.value)}
    />
  )
}

export function PropertiesPanel({ path }: { path: string }): React.JSX.Element {
  const text = useStore((s) => s.texts[path] ?? '')
  const parsed = useStore((s) => s.parsed)
  const setNoteProperties = useStore((s) => s.setNoteProperties)
  const applySupertag = useStore((s) => s.applySupertag)
  const ensureDailyNote = useStore((s) => s.ensureDailyNote)
  const openNote = useStore((s) => s.openNote)
  const navigate = useStore((s) => s.navigate)
  const openTag = useStore((s) => s.openTag)
  const files = useStore((s) => s.files)
  const index = useStore((s) => s.index)
  // Lets a frontmatter value's [[wikilinks]] render as clickable chips (alias-aware).
  const inline = {
    isResolved: (raw: string): boolean =>
      (resolveTarget(raw, files.map((f) => f.path)) ?? index.resolvePath(raw)) !== null,
    onNavigate: navigate,
    onTag: openTag
  }
  const [adding, setAdding] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [typeMenu, setTypeMenu] = useState<{ key: string; x: number; y: number } | null>(null)

  const data = useMemo(() => getFrontmatter(text), [text])

  // --- Tags (incl. supertags) ---
  const stIndex = useMemo(() => buildSupertagIndex(supertagsFromParsed(parsed)), [parsed])
  const tagList = (): string[] => {
    const raw = data.tags
    return Array.isArray(raw)
      ? raw.map(String)
      : typeof raw === 'string'
        ? raw.split(/[,\s]+/).filter(Boolean)
        : []
  }
  const tags = tagList()
  /** All tag names in the vault plus every supertag, for the add-tag picker. */
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of Object.values(parsed)) for (const t of n.tags) set.add(t)
    for (const s of supertagsFromParsed(parsed)) set.add(s.name)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [parsed])
  const removeTag = (t: string): void => {
    const next = { ...data }
    const kept = tags.filter((x) => x !== t)
    if (kept.length) next.tags = kept
    else delete next.tags
    void setNoteProperties(path, next)
  }

  // --- Supertag fields: shown as their own editable section when the note is an instance ---
  const fields = fieldsForNote(tags, stIndex)
  const fieldNames = new Set(fields.map((f) => f.name))

  // `pinned`/`tags`/supertag fields — and a supertag definition's own `fields:`/
  // `extends:` schema — are surfaced in their own UI, not as generic property rows.
  const userKeys = Object.keys(data).filter(
    (k) =>
      !isSystemProp(k) &&
      k !== 'pinned' &&
      k !== 'tags' &&
      !fieldNames.has(k) &&
      !isSupertagSchemaKey(path, k)
  )
  const cover = useMemo(() => Object.keys(data).map((k) => imageValue(data[k])).find(Boolean) ?? null, [data])

  // Most types are inferred from the value, but some (e.g. an empty Date) can't be —
  // so an explicitly chosen type is remembered in a hidden `_types` map.
  const storedTypes: Record<string, unknown> =
    data._types && typeof data._types === 'object' && !Array.isArray(data._types)
      ? (data._types as Record<string, unknown>)
      : {}
  // Select vocabularies defined anywhere in the vault, so one note can type a
  // property that a thousand notes carry (lib/propSchema).
  const schemas = useMemo(() => vaultPropSchemas(Object.values(parsed)), [parsed])
  const effType = (key: string): PropType => {
    const t = storedTypes[key]
    if (typeof t === 'string' && PROP_TYPES.some((p) => p.value === t)) return t as PropType
    // An inherited option list makes it a Select here too — that's what inheriting means.
    return schemas[key] ? 'select' : typeOf(data[key])
  }
  // User-defined Select options, kept per-property in a hidden `_options` map —
  // this note's own if it has one, else the vault's.
  const storedOptions: Record<string, unknown> =
    data._options && typeof data._options === 'object' && !Array.isArray(data._options)
      ? (data._options as Record<string, unknown>)
      : {}
  const localOptions = (key: string): string[] =>
    Array.isArray(storedOptions[key]) ? (storedOptions[key] as unknown[]).map(String) : []
  const optionsFor = (key: string): string[] => {
    const own = localOptions(key)
    return own.length ? own : (schemas[key]?.options ?? [])
  }
  // Per-option colours, kept in the parallel hidden `_colors` map (lib/propColors).
  const colorsFor = (key: string): Record<string, OptionColor> =>
    localOptions(key).length ? optionColors(data, key) : (schemas[key]?.colors ?? {})
  /** The note a Select's options belong to: this one if it defines them, else
   *  wherever the vault defines them — so editing options updates the shared
   *  definition rather than forking a private copy into this note. */
  const optionsHome = (key: string): string =>
    localOptions(key).length ? path : (schemas[key]?.from ?? path)

  const update = (key: string, value: unknown): void => {
    void setNoteProperties(path, { ...data, [key]: value })
  }
  /** Write a Select's options and their colours in ONE frontmatter update — two
   *  writes would race through `queueWrite` with a half-updated `_colors` map.
   *  The schema goes to its home note; `value` is this note's own and stays here. */
  const setOptions = (
    key: string,
    options: string[],
    colors: Record<string, OptionColor>,
    value?: string
  ): void => {
    const home = optionsHome(key)
    const homeFm = home === path ? data : getFrontmatter(useStore.getState().texts[home] ?? '')
    let next = withOptions(homeFm, key, options)
    next = withOptionColors(next, key, options.length ? colors : {})
    if (value !== undefined && home === path) next[key] = value
    void setNoteProperties(home, next)
    if (value !== undefined && home !== path) void setNoteProperties(path, { ...data, [key]: value })
  }
  /** Change a property's type — coerce the value, and remember the choice when inference can't. */
  const changeType = (key: string, t: PropType): void => {
    const coerced = coerceTo(data[key], t)
    const types = { ...storedTypes }
    // Also remember the choice when an inherited vault schema would otherwise
    // re-assert Select over it — inference alone can't out-vote the schema.
    if (t !== typeOf(coerced) || schemas[key]) types[key] = t
    else delete types[key]
    let next: Record<string, unknown> = { ...data, [key]: coerced }
    if (Object.keys(types).length) next._types = types
    else delete next._types
    // Options and their colours only belong to Select — drop both otherwise.
    if (t !== 'select') next = withOptionColors(withOptions(next, key, []), key, {})
    void setNoteProperties(path, next)
  }
  const remove = (key: string): void => {
    let next = { ...data }
    delete next[key]
    if (storedTypes[key] !== undefined) {
      const types = { ...storedTypes }
      delete types[key]
      if (Object.keys(types).length) next._types = types
      else delete next._types
    }
    next = withOptionColors(withOptions(next, key, []), key, {})
    void setNoteProperties(path, next)
  }
  const openDate = (iso: string): void => void ensureDailyNote(iso).then(openNote)

  return (
    <div className="props">
      {cover && <img className="prop-cover" src={assetUrl(cover)} alt="cover" />}

      <div className="props-section">
        <div className="props-label">Tags</div>
        <div className="prop-tags">
          {tags.map((t) => {
            const isSuper = stIndex.has(normTag(t))
            return (
              <span className={'prop-tag' + (isSuper ? ' supertag' : '')} key={t}>
                {isSuper ? '▤ ' : '#'}
                {t}
                <button className="prop-tag-x" title="Remove tag" onClick={() => removeTag(t)}>
                  ✕
                </button>
              </span>
            )
          })}
          {addingTag ? (
            <input
              className="prop-input prop-tag-in"
              autoFocus
              list="prop-all-tags"
              placeholder="tag…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = e.currentTarget.value.trim()
                  if (v) void applySupertag(path, v)
                  setAddingTag(false)
                } else if (e.key === 'Escape') setAddingTag(false)
              }}
              onBlur={() => setAddingTag(false)}
            />
          ) : (
            <button className="prop-tag-add" onClick={() => setAddingTag(true)}>
              ＋ Tag
            </button>
          )}
          <datalist id="prop-all-tags">
            {allTags.filter((t) => !tags.some((x) => normTag(x) === normTag(t))).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="props-section">
        <div className="props-label">Properties</div>
        {fields.length === 0 && userKeys.length === 0 && <div className="props-empty">No properties</div>}

        {/* Supertag fields first — typed by the tag, so no per-row type menu / delete. */}
        {fields.map((f) => {
          const iconType: PropType =
            f.type === 'select' || f.type === 'link' || f.type === 'url' ? 'text' : f.type
          return (
            <div className="prop-row is-field" key={'field:' + f.name}>
              <span className="prop-key prop-key-field" title={`${f.name} · ${f.type} — from a tag's schema`}>
                <PropIcon type={iconType} name={f.name} />
                <span className="prop-key-name">{f.name.replace(/_/g, ' ')}</span>
              </span>
              <div className="prop-val">
                <ValueEditor
                  type={f.type}
                  value={data[f.name]}
                  options={f.options}
                  onCommit={(v) => update(f.name, v)}
                  onOpenDate={openDate}
                  onOpenNote={(n) => void navigate(n)}
                  inline={inline}
                />
              </div>
            </div>
          )
        })}

        {userKeys.map((key) => {
          const t = effType(key)
          return (
            <div className="prop-row" key={key}>
              <button
                className="prop-key"
                title={`${key} · ${t} — click to change type`}
                onClick={(e) => setTypeMenu({ key, x: e.clientX, y: e.clientY })}
              >
                <PropIcon type={t} name={key} />
                <span className="prop-key-name">{key.replace(/_/g, ' ')}</span>
              </button>
              <div className="prop-val">
                {t === 'select' ? (
                  <UserSelectEditor
                    value={data[key]}
                    options={optionsFor(key)}
                    colors={colorsFor(key)}
                    onCommit={(v) => update(key, v)}
                    onAddOption={(name) => {
                      const opts = optionsFor(key)
                      if (opts.includes(name)) return
                      const next = [...opts, name]
                      setOptions(key, next, seedColors(next, colorsFor(key)))
                    }}
                    onRenameOption={(from, to) => {
                      const next = optionsFor(key).map((o) => (o === from ? to : o))
                      // The stored value is the option NAME, so a rename has to carry it.
                      setOptions(
                        key,
                        next,
                        renameOption(colorsFor(key), from, to),
                        data[key] === from ? to : undefined
                      )
                    }}
                    onRemoveOption={(name) => {
                      const next = optionsFor(key).filter((o) => o !== name)
                      setOptions(
                        key,
                        next,
                        seedColors(next, colorsFor(key)),
                        data[key] === name ? '' : undefined
                      )
                    }}
                    onSetColor={(name, color) =>
                      setOptions(key, optionsFor(key), { ...seedColors(optionsFor(key), colorsFor(key)), [name]: color })
                    }
                  />
                ) : (
                  <ValueEditor type={t} value={data[key]} onCommit={(v) => update(key, v)} onOpenDate={openDate} inline={inline} />
                )}
              </div>
              <button className="prop-del" title="Remove" onClick={() => remove(key)}>
                ✕
              </button>
            </div>
          )
        })}

        {adding ? (
          <input
            className="prop-input prop-newkey"
            autoFocus
            placeholder="property name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const k = e.currentTarget.value.trim()
                if (k && data[k] === undefined) update(k, '')
                setAdding(false)
              } else if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={() => setAdding(false)}
          />
        ) : (
          <button className="prop-add" onClick={() => setAdding(true)}>
            ＋ Add property
          </button>
        )}
      </div>
      {typeMenu && (
        <ContextMenu
          x={typeMenu.x}
          y={typeMenu.y}
          items={PROP_TYPES.map((p) => ({
            label: (effType(typeMenu.key) === p.value ? '• ' : '') + p.label,
            onClick: () => changeType(typeMenu.key, p.value)
          }))}
          onClose={() => setTypeMenu(null)}
        />
      )}
    </div>
  )
}
