/**
 * Frontmatter read/write backed by the `yaml` package. Reads use plain
 * YAML.parse (YAML 1.2 core schema: bare dates/datetimes stay strings, so
 * values round-trip exactly). Edits go through YAML.parseDocument so that
 * comments, key order and the formatting of untouched keys are preserved —
 * only the keys that actually changed are rewritten.
 */
import * as YAML from 'yaml'

export interface Frontmatter {
  data: Record<string, unknown>
  /** Note body with the frontmatter block removed. */
  body: string
  /** Line index where the body begins (keeps block line numbers accurate). */
  bodyLine: number
  /** The raw frontmatter block including fences + trailing newline, or ''. */
  raw: string
}

const FENCE = /^---\s*$/

/** Lenient parse options: duplicate keys warn (last wins) instead of erroring. */
const PARSE_OPTS = { uniqueKeys: false } as const

/**
 * Defensive coercion for values headed into/out of yaml: JS Date objects aren't
 * part of the core schema, so turn them into `YYYY-MM-DD` strings (or a full
 * ISO string when they carry a time-of-day component).
 */
function deDate(v: unknown): unknown {
  if (v instanceof Date) {
    const p = (n: number): string => String(n).padStart(2, '0')
    const date = `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() || v.getUTCMilliseconds()
    return hasTime ? v.toISOString() : date
  }
  if (Array.isArray(v)) return v.map(deDate)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = deDate(val)
    return o
  }
  return v
}

/** Index of the closing `---` fence line, or -1 when there is no frontmatter. */
function fenceEnd(lines: string[]): number {
  if (lines.length === 0 || !FENCE.test(lines[0])) return -1
  for (let i = 1; i < lines.length; i++) if (FENCE.test(lines[i])) return i
  return -1
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split('\n')
  const end = fenceEnd(lines)
  if (end === -1) return { data: {}, body: text, bodyLine: 0, raw: '' }

  // Only a block that parses to a YAML mapping (or nothing) is frontmatter.
  // A note that merely *starts* with an `---` hr followed by prose must keep
  // its full body — treating it as frontmatter silently swallows the text.
  let data: Record<string, unknown> = {}
  try {
    const loaded = YAML.parse(lines.slice(1, end).join('\n'), PARSE_OPTS)
    if (loaded === null || loaded === undefined) {
      // empty block between fences — valid, empty frontmatter
    } else if (typeof loaded === 'object' && !Array.isArray(loaded)) {
      data = deDate(loaded) as Record<string, unknown>
    } else {
      return { data: {}, body: text, bodyLine: 0, raw: '' }
    }
  } catch {
    // malformed YAML — not frontmatter; keep the whole text as body
    return { data: {}, body: text, bodyLine: 0, raw: '' }
  }

  let bodyLine = end + 1
  if (lines[bodyLine]?.trim() === '') bodyLine++ // skip a single blank line after FM
  return {
    data,
    body: lines.slice(bodyLine).join('\n'),
    bodyLine,
    raw: lines.slice(0, end + 1).join('\n') + '\n'
  }
}

/** Wrap a yaml string as a frontmatter block, normalizing the trailing newline. */
function wrapBlock(yamlText: string): string {
  const inner = yamlText.replace(/\n+$/, '')
  return inner ? `---\n${inner}\n---\n` : ''
}

/** Serialize a data object to a fresh frontmatter block (`---\n…\n---\n`), or '' if empty. */
export function serializeFrontmatter(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) return ''
  return wrapBlock(YAML.stringify(deDate(data), { lineWidth: 0 }))
}

/** Deep value equality via canonical JSON (fine for frontmatter-sized data). */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Replace (or add/remove) the frontmatter of `text`, preserving the body.
 * Format-preserving: the existing block is parsed as a YAML *document* and only
 * the keys whose values actually changed are set/deleted, so comments, key
 * order, quoting style and the layout of untouched keys survive the edit.
 */
export function replaceFrontmatter(text: string, data: Record<string, unknown>): string {
  const lines = text.split('\n')
  const end = fenceEnd(lines)
  const { body } = parseFrontmatter(text)
  if (Object.keys(data).length === 0) return body

  let doc: YAML.Document | null = null
  if (end !== -1) {
    const parsed = YAML.parseDocument(lines.slice(1, end).join('\n'), PARSE_OPTS)
    // Only patch a well-formed mapping (or an empty block); otherwise rebuild.
    if (parsed.errors.length === 0 && (parsed.contents === null || YAML.isMap(parsed.contents))) {
      doc = parsed
    }
  }

  if (!doc) {
    // No (usable) existing block — emit a fresh one.
    const fm = serializeFrontmatter(data)
    return body.trim() === '' ? `${fm}\n` : `${fm}\n${body}`
  }

  const oldNorm = deDate(doc.toJS() ?? {}) as Record<string, unknown>
  for (const key of Object.keys(oldNorm)) {
    if (!(key in data)) doc.delete(key)
  }
  for (const [key, value] of Object.entries(data)) {
    if (key in oldNorm && sameValue(oldNorm[key], value)) continue // untouched: keep formatting
    doc.set(key, deDate(value))
  }

  const fm = wrapBlock(doc.toString({ lineWidth: 0 }))
  if (!fm) return body
  return body.trim() === '' ? `${fm}\n` : `${fm}\n${body}`
}

export function getFrontmatter(text: string): Record<string, unknown> {
  return parseFrontmatter(text).data
}

export function stripFrontmatter(text: string): string {
  return parseFrontmatter(text).body
}

/** Body text without the frontmatter block — no YAML parse, just fence slicing. */
export function stripFrontmatterFast(text: string): string {
  const lines = text.split('\n')
  const end = fenceEnd(lines)
  if (end === -1) return text
  // Cheap mapping-shape check (mirrors parseFrontmatter's YAML-mapping rule):
  // every non-blank top-level line must be indented, a comment, a list item, or
  // contain a `:`. Prose after a leading `---` hr is NOT frontmatter.
  for (let i = 1; i < end; i++) {
    const l = lines[i]
    if (l.trim() === '' || /^[\s#-]/.test(l) || l.includes(':')) continue
    return text
  }
  let bodyLine = end + 1
  if (lines[bodyLine]?.trim() === '') bodyLine++
  return lines.slice(bodyLine).join('\n')
}

/** True for system properties hidden from the UI (Tolaria's `_` convention). */
export function isSystemProp(key: string): boolean {
  return key.startsWith('_')
}

/**
 * Normalised tag list from a note's frontmatter `tags` property. Accepts a YAML
 * list (`tags: [a, b]`) or a comma/space string (`tags: a, b`); strips a leading
 * `#` and lowercases, so frontmatter tags line up with inline `#tags`.
 */
export function frontmatterTags(data: Record<string, unknown>): string[] {
  const raw = (data as { tags?: unknown }).tags
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []
  return arr.map((t) => String(t).replace(/^#/, '').trim().toLowerCase()).filter(Boolean)
}

/**
 * Alternate names from a note's frontmatter `aliases:` (or singular `alias:`).
 * Accepts a YAML list (`aliases: [A, B]`) or a comma-separated string. Case is
 * preserved (aliases are display names), but any surrounding `[[ ]]` is stripped.
 */
export function frontmatterAliases(data: Record<string, unknown>): string[] {
  const raw = (data as { aliases?: unknown; alias?: unknown }).aliases ?? (data as { alias?: unknown }).alias
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return arr
    .map((a) => String(a).trim().replace(/^\[\[|\]\]$/g, '').trim())
    .filter(Boolean)
}
