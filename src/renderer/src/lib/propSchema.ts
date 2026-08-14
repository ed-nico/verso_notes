/**
 * Vault-wide Select schemas.
 *
 * A Select property's options and colours live in frontmatter (`_options` /
 * `_colors`, see lib/propColors) — but a property like `Sleep` is one idea shared
 * by a thousand daily notes, and copying the option list into every one of them
 * would bury a single word under ten lines of bookkeeping, and let the copies
 * drift the moment an option is renamed.
 *
 * So a property defined ANYWHERE in the vault is defined EVERYWHERE: one note
 * carries `_options: { Sleep: [...] }`, and every other note with a `Sleep`
 * property gets the same dropdown. `from` records which note that was, so editing
 * the options writes back to the definition instead of forking a local copy.
 *
 * Deliberately keyed off `_options` alone, never `_types`: propagating a bare type
 * across the vault would mean one note calling its `Status` a Date silently retyped
 * every other note's `Status`. An option LIST is an explicit, shared vocabulary; a
 * type is a per-note detail.
 */

import { optionColors, type OptionColor } from './propColors'

export interface PropSchema {
  /** The note the options were read from — where an edit to them belongs. */
  from: string
  options: string[]
  colors: Record<string, OptionColor>
}

interface SchemaSource {
  path: string
  frontmatter: Record<string, unknown>
}

/** Every Select vocabulary defined in the vault, keyed by property name. When two
 *  notes define the same property, the first by path wins — an arbitrary choice,
 *  but a STABLE one (hydration order isn't). */
export function vaultPropSchemas(notes: Iterable<SchemaSource>): Record<string, PropSchema> {
  const out: Record<string, PropSchema> = {}
  // Filter BEFORE sorting: a handful of notes in a vault define options, and
  // sorting the whole vault to order three of them was the bulk of the cost.
  const definers: SchemaSource[] = []
  for (const n of notes) {
    const raw = n.frontmatter._options
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) definers.push(n)
  }
  definers.sort((a, b) => a.path.localeCompare(b.path))
  for (const n of definers) {
    const raw = n.frontmatter._options
    for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
      if (out[key] || !Array.isArray(list) || list.length === 0) continue
      out[key] = {
        from: n.path,
        options: list.map(String),
        colors: optionColors(n.frontmatter, key)
      }
    }
  }
  return out
}

let memoSrc: object | null = null
let memoOut: Record<string, PropSchema> = {}

/**
 * Vault schemas for the store's `parsed` map, memoised on that map's IDENTITY.
 *
 * The properties panel and every base — including each `{{base}}` embedded in the
 * note on screen — needs this, and each was walking the vault for itself on every
 * rebuild. They can all share one computation because `parsed` is replaced rather
 * than mutated whenever its contents change (unlike `texts`), so its identity is
 * exactly the right cache key.
 */
export function propSchemasFor(parsed: Record<string, SchemaSource>): Record<string, PropSchema> {
  if (memoSrc === parsed) return memoOut
  memoSrc = parsed
  memoOut = vaultPropSchemas(Object.values(parsed))
  return memoOut
}

/** Write back the `_options` map with `key` set (or cleared when empty). Mirrors
 *  `withOptionColors`, so the two hidden maps are maintained the same way. */
export function withOptions(
  base: Record<string, unknown>,
  key: string,
  options: string[]
): Record<string, unknown> {
  const all =
    base._options && typeof base._options === 'object' && !Array.isArray(base._options)
      ? { ...(base._options as Record<string, unknown>) }
      : {}
  if (options.length) all[key] = options
  else delete all[key]
  const next = { ...base }
  if (Object.keys(all).length) next._options = all
  else delete next._options
  return next
}
