/**
 * Supertags — a tag that also defines a TYPE (à la Tana supertags / Logseq DB
 * "tags as classes"). A supertag is just a note living under the `Tags/` folder:
 * its filename is the tag name and its frontmatter declares a field schema and
 * optional parent supertags to inherit from.
 *
 *   Tags/Person.md
 *   ---
 *   extends: [Contact]
 *   fields:
 *     email: text
 *     company: link
 *     status: { type: select, options: [active, lead, archived] }
 *   ---
 *
 * Any note that carries `#person` (inline or via frontmatter `tags:`) is then an
 * INSTANCE of that supertag: the Properties panel offers its fields, and the tag's
 * page collects every instance into a table.
 */
import type { ParsedNote } from '@shared/types'

export const TAGS_DIR = 'Tags'

export type FieldType = 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'link' | 'select' | 'url'

export const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'checkbox', 'list', 'link', 'select', 'url']

export interface FieldDef {
  name: string
  type: FieldType
  /** Allowed values, for `select` fields. */
  options?: string[]
}

export interface Supertag {
  /** Normalised (lowercased) tag name — how it matches `#tags`. */
  tag: string
  /** Display name = the definition note's filename. */
  name: string
  /** Path of the definition note, e.g. `Tags/Person.md`. */
  path: string
  /** Parent supertag tag-names to inherit fields from. */
  extends: string[]
  /** Fields declared on this supertag (before inheritance). */
  fields: FieldDef[]
}

export const normTag = (s: string): string => s.replace(/^#/, '').trim().toLowerCase()

function normType(t: string): FieldType {
  const x = t.toLowerCase()
  return (FIELD_TYPES as string[]).includes(x) ? (x as FieldType) : 'text'
}

/** Parse a frontmatter `fields:` map into FieldDefs (value = type string, or `{type, options}`). */
function parseFields(raw: unknown): FieldDef[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const out: FieldDef[] = []
  for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof def === 'string') {
      out.push({ name, type: normType(def) })
    } else if (def && typeof def === 'object') {
      const d = def as { type?: unknown; options?: unknown }
      out.push({
        name,
        type: normType(typeof d.type === 'string' ? d.type : 'text'),
        options: Array.isArray(d.options) ? d.options.map(String) : undefined
      })
    }
  }
  return out
}

function parseExtends(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []
  return arr.map((t) => normTag(String(t))).filter(Boolean)
}

/** Serialize FieldDefs back into a frontmatter `fields:` map. */
export function fieldsToFrontmatter(fields: FieldDef[]): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  for (const f of fields) map[f.name] = f.options?.length ? { type: f.type, options: f.options } : f.type
  return map
}

/** Every supertag defined in the vault (one per note under `Tags/`). */
export function supertagsFromParsed(parsed: Record<string, ParsedNote>): Supertag[] {
  const out: Supertag[] = []
  for (const n of Object.values(parsed)) {
    if (!n.path.startsWith(TAGS_DIR + '/')) continue
    out.push({
      tag: normTag(n.name),
      name: n.name,
      path: n.path,
      extends: parseExtends(n.frontmatter.extends),
      fields: parseFields(n.frontmatter.fields)
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function buildSupertagIndex(list: Supertag[]): Map<string, Supertag> {
  return new Map(list.map((s) => [s.tag, s]))
}

/** Fields for a supertag, with parent (`extends`) fields merged in; own fields win. */
export function resolveFields(tag: string, index: Map<string, Supertag>, seen = new Set<string>()): FieldDef[] {
  const st = index.get(normTag(tag))
  if (!st || seen.has(st.tag)) return []
  seen.add(st.tag)
  const byName = new Map<string, FieldDef>()
  for (const parent of st.extends) for (const f of resolveFields(parent, index, seen)) byName.set(f.name, f)
  for (const f of st.fields) byName.set(f.name, f)
  return [...byName.values()]
}

/** The supertags a note carries (matched against its tag list). */
export function supertagsForNote(noteTags: string[], index: Map<string, Supertag>): Supertag[] {
  const have = new Set(noteTags.map(normTag))
  return [...index.values()].filter((s) => have.has(s.tag))
}

/** Union of resolved fields across all supertags a note carries (own/earlier win). */
export function fieldsForNote(noteTags: string[], index: Map<string, Supertag>): FieldDef[] {
  const byName = new Map<string, FieldDef>()
  for (const st of supertagsForNote(noteTags, index)) {
    for (const f of resolveFields(st.tag, index)) if (!byName.has(f.name)) byName.set(f.name, f)
  }
  return [...byName.values()]
}
