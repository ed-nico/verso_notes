/**
 * Colours for Select-property options.
 *
 * A Select property keeps its allowed values in the hidden `_options` frontmatter
 * map (see `propOptions` in PropertiesPanel); this file adds the parallel `_colors`
 * map that paints them:
 *
 *     _types:   { Sleep: select }
 *     _options: { Sleep: [Good, Average, Bad] }
 *     _colors:  { Sleep: { Good: green, Average: orange, Bad: red } }
 *
 * A separate map rather than encoding the colour into the option string, so an
 * option's stored value stays the plain word the note's frontmatter already holds
 * (`Sleep: Good`) — colours are presentation, never data. Both maps are keyed by
 * the OPTION NAME, so renaming an option has to move its colour with it
 * (`renameOption`), and an unknown/absent name simply renders uncoloured.
 *
 * The names here are tokens, not CSS colours: each maps to a `--oc-*` variable
 * defined per theme in `styles/panels.css`, so a chip stays legible on the dark,
 * light and paper canvases.
 */

export const OPTION_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink'
] as const

export type OptionColor = (typeof OPTION_COLORS)[number]

const isColor = (v: unknown): v is OptionColor =>
  typeof v === 'string' && (OPTION_COLORS as readonly string[]).includes(v)

/** Colour map for `fm[key]`'s options, from the hidden `_colors` frontmatter map. */
export function optionColors(fm: Record<string, unknown>, key: string): Record<string, OptionColor> {
  const all =
    fm._colors && typeof fm._colors === 'object' && !Array.isArray(fm._colors)
      ? (fm._colors as Record<string, unknown>)
      : {}
  const mine = all[key]
  if (!mine || typeof mine !== 'object' || Array.isArray(mine)) return {}
  const out: Record<string, OptionColor> = {}
  for (const [name, c] of Object.entries(mine as Record<string, unknown>)) {
    if (isColor(c)) out[name] = c
  }
  return out
}

/** Write back the `_colors` map with `key` set (or cleared when empty). */
export function withOptionColors(
  base: Record<string, unknown>,
  key: string,
  colors: Record<string, OptionColor>
): Record<string, unknown> {
  const all =
    base._colors && typeof base._colors === 'object' && !Array.isArray(base._colors)
      ? { ...(base._colors as Record<string, unknown>) }
      : {}
  if (Object.keys(colors).length) all[key] = colors
  else delete all[key]
  const next = { ...base }
  if (Object.keys(all).length) next._colors = all
  else delete next._colors
  return next
}

/** Words whose meaning implies a colour, so the common good/average/bad scale is
 *  already painted the moment the options are typed. Matched on the whole option
 *  name, lowercased — a partial match would colour "not good" green. */
const MEANING: Record<OptionColor, string[]> = {
  green: ['good', 'great', 'excellent', 'high', 'yes', 'done', 'complete', 'completed', 'active', 'well', 'up'],
  orange: ['average', 'ok', 'okay', 'medium', 'moderate', 'fair', 'partial', 'meh', 'maybe', 'so-so', 'pending'],
  red: ['bad', 'poor', 'low', 'no', 'terrible', 'awful', 'blocked', 'missed', 'none', 'down', 'broken'],
  gray: ['n/a', 'unknown', 'skipped', 'archived'],
  yellow: [],
  teal: [],
  blue: [],
  purple: [],
  pink: []
}

const BY_WORD: Record<string, OptionColor> = Object.fromEntries(
  Object.entries(MEANING).flatMap(([c, words]) => words.map((w) => [w, c as OptionColor]))
)

/** The colour a NEW option starts with: its meaning if the word has one, else the
 *  next palette hue by position, so every option is distinguishable without work. */
export function defaultColor(name: string, index: number): OptionColor {
  const known = BY_WORD[name.trim().toLowerCase()]
  if (known) return known
  // Skip `gray` (index 0) when cycling — it reads as "unset", not as a choice.
  return OPTION_COLORS[1 + (index % (OPTION_COLORS.length - 1))]
}

/** Colours for `options`, keeping any the user already chose and seeding the rest.
 *  Entries for options that no longer exist are dropped. */
export function seedColors(
  options: string[],
  existing: Record<string, OptionColor>
): Record<string, OptionColor> {
  const out: Record<string, OptionColor> = {}
  options.forEach((o, i) => {
    out[o] = existing[o] ?? defaultColor(o, i)
  })
  return out
}

/** Move an option's colour when the option is renamed (a no-op if it had none). */
export function renameOption(
  colors: Record<string, OptionColor>,
  from: string,
  to: string
): Record<string, OptionColor> {
  if (from === to) return colors
  const out = { ...colors }
  const c = out[from]
  delete out[from]
  if (c) out[to] = c
  return out
}
