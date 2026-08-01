/**
 * The block query language for `{{query ...}}` blocks.
 *
 * Grammar (v3):
 *   query      :=  (group | directive) ("OR" group)*
 *   group      :=  term+                        — terms within a group are ANDed
 *   term       :=  "-"? atom                    — a leading "-" negates the atom
 *   atom       :=  #tag                         — block carries the tag; hierarchical:
 *                                                  #project also matches #project/alpha
 *              |   [[Page]]                     — block links to this page
 *              |   todo | done                  — incomplete / complete task
 *              |   before:YYYY-MM-DD            — note date strictly before (exclusive)
 *              |   after:YYYY-MM-DD             — note date strictly after (exclusive)
 *              |   prop:key                     — note has frontmatter property `key`
 *              |   prop:key=value               — property equals/contains `value` (loose)
 *              |   word                         — block text contains the word (substring)
 *
 * "OR" must be uppercase; AND binds tighter (no parentheses). A note's date is
 * its journal date when it's a daily note, else its frontmatter `date`; notes
 * without either are excluded by before:/after:.
 *
 * DIRECTIVES shape the result set rather than filtering it. They may appear
 * anywhere in the query and are not part of any AND/OR group:
 *
 *   sort:key    — date | name | path | text | line | status
 *                 prefix the key with `-` to reverse: `sort:-date`.
 *                 Blocks missing the key sink to the bottom in BOTH directions,
 *                 so `sort:-date` means "newest first", not "undated first".
 *   group:key   — note | tag | date | status
 *                 Groups appear in the order their first block does, so `group:`
 *                 composes with `sort:`. Under `group:tag` a block carrying two
 *                 tags appears under both.
 *   limit:N     — keep at most N blocks. Applied AFTER sorting and BEFORE
 *                 grouping, so `sort:-date limit:10 group:note` means "the 10
 *                 most recent, arranged by note".
 *   as:layout   — list (default) | table
 *
 * An unrecognized directive value degrades to a plain word term, matching how
 * `before:` handles an unparseable date — a typo narrows the search instead of
 * silently doing nothing surprising.
 */
import { frontmatterTags, parseFrontmatter } from './frontmatter'
import { isValidISO, parseLooseDate, dailyDateOf } from './dates'
import { parseTarget } from './links'
import { codeRanges, inRanges } from './md'
import { TAG_RE } from './parse'

export interface QueryBlock {
  path: string
  name: string
  /** Absolute line index in the note's full text. */
  line: number
  /** Cleaned display text. */
  text: string
  tags: string[]
  /** Lowercased page names this block links to. */
  links: string[]
  isTask: boolean
  checked: boolean
  /** The note's date (journal date or frontmatter `date`), for before:/after:. */
  date?: string
  /** The note's frontmatter (shared per note), for prop: filters. */
  props?: Record<string, unknown>
}

type AtomKind = 'tag' | 'link' | 'task' | 'date' | 'prop' | 'term'

interface Atom {
  kind: AtomKind
  negated: boolean
  /** tag name / lowercased page / lowercased word (unused for task/date/prop). */
  value: string
  task?: 'todo' | 'done'
  dateOp?: 'before' | 'after'
  /** ISO date for date atoms. */
  dateValue?: string
  propKey?: string
  /** undefined = existence check. */
  propValue?: string
}

interface QueryGroup {
  atoms: Atom[]
}

/** Keys `sort:` understands. */
export type SortKey = 'date' | 'name' | 'path' | 'text' | 'line' | 'status'
const SORT_KEYS = new Set<string>(['date', 'name', 'path', 'text', 'line', 'status'])

/** Keys `group:` understands. */
export type GroupKey = 'note' | 'tag' | 'date' | 'status'
const GROUP_KEYS = new Set<string>(['note', 'tag', 'date', 'status'])

export type QueryLayout = 'list' | 'table'

export interface QuerySpec {
  /** OR-groups; a block matches when EVERY atom of ANY group passes. */
  groups: QueryGroup[]
  /** True when no criteria were given (matches nothing rather than everything).
   *  Directives alone don't count as criteria — `{{query limit:5}}` matches nothing. */
  empty: boolean
  /** `sort:` directive, or undefined to keep vault order. */
  sort?: { key: SortKey; dir: 'asc' | 'desc' }
  /** `group:` directive, or undefined for a flat list. */
  groupBy?: GroupKey
  /** `limit:` directive (positive integer), or undefined for no cap. */
  limit?: number
  /** `as:` directive; defaults to 'list'. */
  layout: QueryLayout
}

/** One `group:`ed bucket of results. */
export interface QueryGroupResult {
  label: string
  blocks: QueryBlock[]
}

/** Everything a renderer needs: the parsed directives plus the shaped results. */
export interface QueryResult {
  spec: QuerySpec
  /** Matching blocks, sorted and limited. */
  blocks: QueryBlock[]
  /** Buckets when `group:` was given, else null. */
  groups: QueryGroupResult[] | null
  /** How many blocks matched before `limit:` was applied. */
  total: number
}

const WIKI_RE = /\[\[([^\]\n]+?)\]\]/g
const ANCHOR_RE = /\s\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/
const TASK_RE = /^\s*([-*+])\s+\[([ xX])\]\s+/

export function parseQuery(raw: string): QuerySpec {
  // Pull [[Page Name]] out first (they may contain spaces), keeping a possible
  // leading "-" and the token's position via a placeholder.
  const links: { negated: boolean; page: string }[] = []
  const rest = raw.replace(/(-?)\[\[([^\]\n]+?)\]\]/g, (_, neg: string, p: string) => {
    links.push({ negated: neg === '-', page: parseTarget(p.split('|')[0]).page.toLowerCase() })
    return ` \x00${links.length - 1} `
  })

  const groups: QueryGroup[] = [{ atoms: [] }]
  const cur = (): QueryGroup => groups[groups.length - 1]
  const shape: Partial<QuerySpec> = {}
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    if (tok === 'OR') {
      if (cur().atoms.length) groups.push({ atoms: [] })
      continue
    }
    // Directives are checked first: they shape the result set and belong to the
    // query as a whole, never to the AND-group they happen to sit in.
    if (applyDirective(tok, shape)) continue
    const atom = parseToken(tok, links)
    if (atom) cur().atoms.push(atom)
  }

  const kept = groups.filter((g) => g.atoms.length > 0)
  return { ...shape, groups: kept, empty: kept.length === 0, layout: shape.layout ?? 'list' }
}

/**
 * Recognize `sort:` / `group:` / `limit:` / `as:` and fold it into `shape`.
 * Returns false for anything else — including a directive with an unusable value,
 * which then falls through to being an ordinary word term (same forgiving
 * behaviour as `before:` with an unparseable date).
 */
function applyDirective(tok: string, shape: Partial<QuerySpec>): boolean {
  const m = /^(sort|group|limit|as):(.+)$/i.exec(tok)
  if (!m) return false
  const kind = m[1].toLowerCase()
  const raw = m[2]

  if (kind === 'limit') {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 1) return false
    shape.limit = Math.floor(n)
    return true
  }
  if (kind === 'as') {
    const v = raw.toLowerCase()
    if (v !== 'list' && v !== 'table') return false
    shape.layout = v
    return true
  }
  if (kind === 'sort') {
    const desc = raw.startsWith('-')
    const key = (desc ? raw.slice(1) : raw).toLowerCase()
    if (!SORT_KEYS.has(key)) return false
    shape.sort = { key: key as SortKey, dir: desc ? 'desc' : 'asc' }
    return true
  }
  const key = raw.toLowerCase()
  if (!GROUP_KEYS.has(key)) return false
  shape.groupBy = key as GroupKey
  return true
}

function parseToken(tok: string, links: { negated: boolean; page: string }[]): Atom | null {
  // Wikilink placeholder (carries its own negation flag). NUL is deliberate: it's
  // the one byte a note's query text can't contain, so it can't collide with user input.
  // eslint-disable-next-line no-control-regex
  const ph = /^\x00(\d+)$/.exec(tok)
  if (ph) {
    const l = links[Number(ph[1])]
    return { kind: 'link', negated: l.negated, value: l.page }
  }

  let negated = false
  if (tok.startsWith('-') && tok.length > 1) {
    negated = true
    tok = tok.slice(1)
  }

  if (tok.startsWith('#') && tok.length > 1) return { kind: 'tag', negated, value: tok.slice(1).toLowerCase() }
  if (/^todo$/i.test(tok)) return { kind: 'task', negated, value: '', task: 'todo' }
  if (/^done$/i.test(tok)) return { kind: 'task', negated, value: '', task: 'done' }

  const date = /^(before|after):(.+)$/i.exec(tok)
  if (date) {
    const iso = parseLooseDate(date[2])
    // isValidISO (not just shape) — `before:2026-13-45` must not become a date
    // atom that string-compares as "all of 2026".
    if (isValidISO(iso)) {
      return { kind: 'date', negated, value: '', dateOp: date[1].toLowerCase() as 'before' | 'after', dateValue: iso }
    }
    // An unparseable date falls through to a plain word match.
  }

  const prop = /^prop:([^=]+)(?:=(.*))?$/i.exec(tok)
  if (prop) {
    return { kind: 'prop', negated, value: '', propKey: prop[1].toLowerCase(), propValue: prop[2]?.toLowerCase() }
  }

  return { kind: 'term', negated, value: tok.toLowerCase() }
}

/** Strip markdown markers so a block reads as plain text. */
function clean(line: string): string {
  return line
    .replace(ANCHOR_RE, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .trim()
}

/**
 * Per-note cache of scanned blocks. Rebuilding the vault index re-scans every
 * note; caching by (path, text) means only the note that actually changed is
 * re-parsed, turning an O(all notes) rebuild into O(1) for a single edit.
 */
const scanCache = new Map<string, { text: string; blocks: QueryBlock[] }>()

/** Extract queryable blocks (one per non-empty content line) from a note. */
export function scanBlocks(path: string, name: string, text: string): QueryBlock[] {
  const cached = scanCache.get(path)
  if (cached && cached.text === text) return cached.blocks
  const blocks = scanBlocksUncached(path, name, text)
  scanCache.set(path, { text, blocks })
  return blocks
}

/** Drop a note from the scan cache (on delete/rename) so it can't leak or resurface. */
export function dropFromScanCache(path: string): void {
  scanCache.delete(path)
}

/** Empty the whole scan cache — call when switching vaults so notes can't leak across. */
export function clearScanCache(): void {
  scanCache.clear()
}

/** The note's date for before:/after: — its journal date, else frontmatter `date`. */
function noteDate(path: string, data: Record<string, unknown>): string | undefined {
  const daily = dailyDateOf(path)
  if (daily) return daily
  const raw = data.date
  if (raw === undefined || raw === null) return undefined
  const s = String(raw).trim()
  if (isValidISO(s.slice(0, 10))) return s.slice(0, 10) // ISO date or datetime
  const loose = parseLooseDate(s)
  return isValidISO(loose) ? loose : undefined
}

function scanBlocksUncached(path: string, name: string, text: string): QueryBlock[] {
  const { data, body, bodyLine } = parseFrontmatter(text)
  const date = noteDate(path, data)
  const lines = body.split('\n')
  const out: QueryBlock[] = []
  // Code detection defers to the shared `codeRanges` oracle — a private fence
  // scanner here had already drifted from it (mixed ```/~~~ markers, inline
  // spans), so queries could find tags the tag index says don't exist.
  const skip = codeRanges(body)
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineStart = offset
    offset += raw.length + 1
    if (raw.trim() === '') continue
    // Skip lines inside fenced code (including the fence markers themselves).
    if (inRanges(lineStart + raw.search(/\S/), skip)) continue
    const t = clean(raw)
    if (!t) continue
    // A {{query}} block must never match itself (or another query) — skip them.
    if (/^\{\{query\b/i.test(t)) continue
    const taskM = raw.match(TASK_RE)
    const tags: string[] = []
    const links: string[] = []
    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(raw))) {
      if (!inRanges(lineStart + m.index, skip)) tags.push(m[2].toLowerCase())
    }
    WIKI_RE.lastIndex = 0
    while ((m = WIKI_RE.exec(raw))) {
      if (!inRanges(lineStart + m.index, skip)) links.push(parseTarget(m[1].split('|')[0]).page.toLowerCase())
    }
    out.push({
      path,
      name,
      line: bodyLine + i,
      text: t.slice(0, 200),
      tags,
      links,
      isTask: !!taskM,
      checked: taskM ? taskM[2].toLowerCase() === 'x' : false,
      date,
      props: data
    })
  }
  // Frontmatter `tags:` apply to the whole note — attach them to the first block
  // so a tag query surfaces the note once (rather than flooding every line).
  const fmTags = frontmatterTags(data)
  if (out.length && fmTags.length) {
    const s = new Set(out[0].tags)
    for (const t of fmTags) s.add(t)
    out[0].tags = [...s]
  }
  return out
}

/** Hierarchical tag match: `project` matches `project` and `project/alpha`. */
function tagMatches(blockTag: string, queryTag: string): boolean {
  return blockTag === queryTag || blockTag.startsWith(queryTag + '/')
}

function matchAtom(b: QueryBlock, a: Atom): boolean {
  switch (a.kind) {
    case 'tag':
      return b.tags.some((t) => tagMatches(t, a.value))
    case 'link':
      return b.links.includes(a.value)
    case 'task':
      return a.task === 'todo' ? b.isTask && !b.checked : b.isTask && b.checked
    case 'date': {
      if (!b.date || !a.dateValue) return false
      return a.dateOp === 'before' ? b.date < a.dateValue : b.date > a.dateValue
    }
    case 'prop': {
      const props = b.props ?? {}
      const key = Object.keys(props).find((k) => k.toLowerCase() === a.propKey)
      if (key === undefined) return false
      const v = props[key]
      const present = v !== undefined && v !== null && v !== ''
      if (a.propValue === undefined) return present
      if (!present) return false
      const values = Array.isArray(v) ? v : [v]
      // Loose comparison: exact string match, or substring for strings.
      return values.some((x) => String(x).toLowerCase().includes(a.propValue!))
    }
    case 'term':
      return b.text.toLowerCase().includes(a.value)
  }
}

export function matchBlock(b: QueryBlock, spec: QuerySpec): boolean {
  if (spec.empty) return false
  return spec.groups.some((g) => g.atoms.every((a) => matchAtom(b, a) !== a.negated))
}

// ---- result shaping (sort / limit / group) ---------------------------------

/** True when `b` has no usable value for `key` — those sink to the bottom. */
function missingKey(key: SortKey, b: QueryBlock): boolean {
  if (key === 'date') return !b.date
  if (key === 'status') return !b.isTask
  return false
}

function compareKey(key: SortKey, a: QueryBlock, b: QueryBlock): number {
  switch (key) {
    case 'date':
      return a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0
    case 'name':
      return a.name.localeCompare(b.name)
    case 'path':
      return a.path.localeCompare(b.path)
    case 'text':
      return a.text.localeCompare(b.text)
    case 'line':
      return a.line - b.line
    case 'status':
      // Open tasks first: the interesting end of a todo list.
      return Number(a.checked) - Number(b.checked)
  }
}

/** Sort a copy of `blocks` by the spec's `sort:` directive (no-op without one). */
export function sortBlocks(blocks: QueryBlock[], spec: QuerySpec): QueryBlock[] {
  const sort = spec.sort
  if (!sort) return blocks
  const sign = sort.dir === 'desc' ? -1 : 1
  return [...blocks].sort((a, b) => {
    // Blocks with nothing to sort by go last in BOTH directions, so reversing
    // the order never floats a pile of undated rows to the top.
    const am = missingKey(sort.key, a)
    const bm = missingKey(sort.key, b)
    if (am !== bm) return am ? 1 : -1
    if (!am) {
      const c = compareKey(sort.key, a, b)
      if (c !== 0) return sign * c
    }
    // Stable, deterministic tiebreak — the vault iteration order isn't meaningful.
    return a.path.localeCompare(b.path) || a.line - b.line
  })
}

/** The bucket label(s) a block belongs under. A multi-tag block joins several. */
function groupLabels(key: GroupKey, b: QueryBlock): string[] {
  switch (key) {
    case 'note':
      return [b.name]
    case 'tag':
      return b.tags.length ? b.tags.map((t) => `#${t}`) : ['Untagged']
    case 'date':
      return [b.date ?? 'No date']
    case 'status':
      return [b.isTask ? (b.checked ? 'Done' : 'To do') : 'Notes']
  }
}

/** Bucket `blocks` per the spec's `group:` directive; null when it has none. */
export function groupBlocks(blocks: QueryBlock[], spec: QuerySpec): QueryGroupResult[] | null {
  const key = spec.groupBy
  if (!key) return null
  // Insertion-ordered, so groups appear in the order their first block does and
  // `group:` composes with `sort:` instead of overriding it.
  const buckets = new Map<string, QueryBlock[]>()
  for (const b of blocks) {
    for (const label of groupLabels(key, b)) {
      const arr = buckets.get(label)
      if (arr) arr.push(b)
      else buckets.set(label, [b])
    }
  }
  return [...buckets].map(([label, bs]) => ({ label, blocks: bs }))
}

/** Apply sort → limit → group to a raw match list. */
export function shapeResults(matched: QueryBlock[], spec: QuerySpec): QueryResult {
  const sorted = sortBlocks(matched, spec)
  const blocks = spec.limit === undefined ? sorted : sorted.slice(0, spec.limit)
  return { spec, blocks, groups: groupBlocks(blocks, spec), total: matched.length }
}
