/**
 * The query language for `{{query ...}}` blocks.
 *
 * Rows are LINES by default and whole NOTES under `scope:notes` — the one
 * language covers both, which is what a Base does (see components/BaseView).
 * `components/QueryBuilder` composes this string by clicking; the text stays the
 * source of truth, so anything hand-written keeps working.
 *
 * Grammar (v4):
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
 *   sort:key    — date | name | path | text | line | status, or — under
 *                 `scope:notes` — ANY frontmatter property (`sort:-Year`).
 *                 Prefix the key with `-` to reverse: `sort:-date`.
 *                 Rows missing the key sink to the bottom in BOTH directions,
 *                 so `sort:-date` means "newest first", not "undated first".
 *   group:key   — note | tag | date | status
 *                 Groups appear in the order their first block does, so `group:`
 *                 composes with `sort:`. Under `group:tag` a block carrying two
 *                 tags appears under both.
 *   limit:N     — keep at most N blocks. Applied AFTER sorting and BEFORE
 *                 grouping, so `sort:-date limit:10 group:note` means "the 10
 *                 most recent, arranged by note".
 *   scope:kind  — blocks (default) | notes
 *                 `scope:notes` makes each ROW A NOTE rather than a line, matched
 *                 against the note's own tags/links/props — which is the only way
 *                 a note whose content is purely frontmatter can ever match.
 *   cols:a,b,c  — columns for `scope:notes`: any frontmatter key (matched
 *                 case-insensitively) plus the pseudo-columns name, tags, date,
 *                 status, excerpt, path. NO SPACES around the commas — the
 *                 language is whitespace-tokenized, so a space ends the directive.
 *   as:layout   — list (default for blocks) | table (default for notes) | gallery
 *
 * An unrecognized directive value degrades to a plain word term, matching how
 * `before:` handles an unparseable date — a typo narrows the search instead of
 * silently doing nothing surprising. `sort:` is the ONE exception: an unknown
 * key there is a property name, because degrading it made `sort:-Year` search
 * for the literal text "sort:-year" and quietly return the wrong rows.
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

export type AtomKind = 'tag' | 'link' | 'task' | 'date' | 'prop' | 'term'

export interface Atom {
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

export interface QueryGroup {
  atoms: Atom[]
}

/** Keys `sort:` understands natively. Any OTHER key is read as a column name —
 *  that's how `sort:-Year` orders notes by a frontmatter property. */
export type SortKey = 'date' | 'name' | 'path' | 'text' | 'line' | 'status' | (string & {})
const SORT_KEYS = new Set<string>(['date', 'name', 'path', 'text', 'line', 'status'])

/** Keys `group:` understands. */
export type GroupKey = 'note' | 'tag' | 'date' | 'status'
const GROUP_KEYS = new Set<string>(['note', 'tag', 'date', 'status'])

export type QueryLayout = 'list' | 'table' | 'gallery'

/** What a row IS. Blocks (lines) by default; `scope:notes` makes rows whole notes. */
export type QueryScope = 'blocks' | 'notes'

/** One note row, for `scope:notes`. */
export interface QueryNote {
  path: string
  name: string
  date?: string
  tags: string[]
  /** Lowercased page names this note links to. */
  links: string[]
  props: Record<string, unknown>
  excerpt: string
  /** Open / total task counts in the note, for the `status` column and sort. */
  todo: number
  done: number
}

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
  /** `scope:` directive; defaults to 'blocks'. */
  scope: QueryScope
  /** `cols:` directive — frontmatter keys (plus the pseudo-columns `name`, `tags`,
   *  `date`, `status`, `excerpt`) shown for `scope:notes`. */
  cols?: string[]
}

/** One `group:`ed bucket of results. Carries whichever kind the scope produced. */
export interface QueryGroupResult {
  label: string
  blocks: QueryBlock[]
  notes?: QueryNote[]
}

/** Everything a renderer needs: the parsed directives plus the shaped results. */
export interface QueryResult {
  spec: QuerySpec
  /** Matching blocks, sorted and limited. Empty under `scope:notes`. */
  blocks: QueryBlock[]
  /** Matching notes under `scope:notes`; null for block scope. */
  notes: QueryNote[] | null
  /** Buckets when `group:` was given, else null. */
  groups: QueryGroupResult[] | null
  /** How many rows matched before `limit:` was applied. */
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
  const scope = shape.scope ?? 'blocks'
  return {
    ...shape,
    groups: kept,
    empty: kept.length === 0,
    scope,
    // Notes default to a table: a note row is a set of properties, and rendering
    // it as a bare list throws away the columns that made it note-scoped.
    layout: shape.layout ?? (scope === 'notes' ? 'table' : 'list')
  }
}

/**
 * Recognize `sort:` / `group:` / `limit:` / `as:` and fold it into `shape`.
 * Returns false for anything else — including a directive with an unusable value,
 * which then falls through to being an ordinary word term (same forgiving
 * behaviour as `before:` with an unparseable date).
 */
function applyDirective(tok: string, shape: Partial<QuerySpec>): boolean {
  const m = /^(sort|group|limit|as|scope|cols):(.+)$/i.exec(tok)
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
    if (v !== 'list' && v !== 'table' && v !== 'gallery') return false
    shape.layout = v
    return true
  }
  if (kind === 'scope') {
    const v = raw.toLowerCase()
    // `note` reads better in a sentence than `notes`; accept both.
    if (v !== 'notes' && v !== 'note' && v !== 'blocks' && v !== 'block') return false
    shape.scope = v.startsWith('note') ? 'notes' : 'blocks'
    return true
  }
  if (kind === 'cols') {
    const cols = raw.split(',').map((c) => c.trim()).filter(Boolean)
    if (!cols.length) return false
    shape.cols = cols
    return true
  }
  if (kind === 'sort') {
    const desc = raw.startsWith('-')
    const key = desc ? raw.slice(1) : raw
    if (!key) return false
    // Unlike the other directives an unknown key is NOT rejected: it's taken as a
    // property name. Rejecting it turned `sort:-Year` into a word term, which
    // silently searched for the literal text "sort:-year" instead of sorting.
    shape.sort = { key: SORT_KEYS.has(key.toLowerCase()) ? key.toLowerCase() : key, dir: desc ? 'desc' : 'asc' }
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

/**
 * The same atoms evaluated against a whole NOTE.
 *
 * This can't be derived from "any block matches": a note whose content lives
 * entirely in frontmatter has no blocks at all, and those are exactly the notes
 * a `scope:notes` query is usually looking for (a film note is four properties
 * and nothing else). So tags/links/props are read from the note, `todo`/`done`
 * ask whether the note contains such a task, and a bare word searches the note's
 * name and body.
 */
function matchNoteAtom(n: QueryNote, body: string, a: Atom): boolean {
  switch (a.kind) {
    case 'tag':
      return n.tags.some((t) => t === a.value || t.startsWith(a.value + '/'))
    case 'link':
      return n.links.includes(a.value)
    case 'task':
      return a.task === 'todo' ? n.todo > 0 : n.done > 0
    case 'date': {
      if (!n.date || !a.dateValue) return false
      return a.dateOp === 'before' ? n.date < a.dateValue : n.date > a.dateValue
    }
    case 'prop': {
      const key = Object.keys(n.props).find((k) => k.toLowerCase() === a.propKey)
      if (key === undefined) return false
      const v = n.props[key]
      const present = v !== undefined && v !== null && v !== ''
      if (a.propValue === undefined) return present
      if (!present) return false
      const values = Array.isArray(v) ? v : [v]
      return values.some((x) => String(x).toLowerCase().includes(a.propValue!))
    }
    case 'term':
      return n.name.toLowerCase().includes(a.value) || body.toLowerCase().includes(a.value)
  }
}

export function matchNote(n: QueryNote, body: string, spec: QuerySpec): boolean {
  if (spec.empty) return false
  return spec.groups.some((g) => g.atoms.every((a) => matchNoteAtom(n, body, a) !== a.negated))
}

// ---- result shaping (sort / limit / group) ---------------------------------

/** True when `b` has no usable value for `key` — those sink to the bottom. */
function missingKey(key: SortKey, b: QueryBlock): boolean {
  if (!SORT_KEYS.has(key)) return true // a property name means nothing to a block
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
    default:
      // A property name — meaningless for a block; missingKey already sent every
      // row to the "missing" bucket, so this is unreachable in practice.
      return 0
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
  return { spec, blocks, notes: null, groups: groupBlocks(blocks, spec), total: matched.length }
}

/** The value shown in a `cols:` column — pseudo-columns first, then frontmatter. */
export function noteColumn(n: QueryNote, col: string): unknown {
  switch (col.toLowerCase()) {
    case 'name':
      return n.name
    case 'tags':
      return n.tags.map((t) => `#${t}`)
    case 'date':
      return n.date
    case 'status':
      return n.todo > 0 ? `${n.todo} open` : n.done > 0 ? 'Done' : ''
    case 'excerpt':
      return n.excerpt
    case 'path':
      return n.path
    default: {
      // Frontmatter keys are matched case-insensitively, so `cols:started` finds
      // a `Started:` property — the capitalisation in a vault is rarely uniform.
      const key = Object.keys(n.props).find((k) => k.toLowerCase() === col.toLowerCase())
      return key === undefined ? undefined : n.props[key]
    }
  }
}

const NOTE_MISSING = (key: SortKey, n: QueryNote): boolean =>
  key === 'date' ? !n.date : key === 'status' ? n.todo === 0 && n.done === 0 : false

/** Sort/limit/group note rows. `sort:` also accepts any `cols:` key by name. */
export function shapeNoteResults(matched: QueryNote[], spec: QuerySpec): QueryResult {
  const sort = spec.sort
  let sorted = matched
  if (sort) {
    const sign = sort.dir === 'desc' ? -1 : 1
    const known = SORT_KEYS.has(sort.key)
    sorted = [...matched].sort((a, b) => {
      if (known) {
        const am = NOTE_MISSING(sort.key, a)
        const bm = NOTE_MISSING(sort.key, b)
        if (am !== bm) return am ? 1 : -1
      }
      // An unknown sort key is read as a column name, so `sort:-Started` orders
      // by that property rather than silently doing nothing.
      const av = known ? noteColumn(a, sort.key) : noteColumn(a, sort.key)
      const bv = known ? noteColumn(b, sort.key) : noteColumn(b, sort.key)
      const ae = av === undefined || av === null || av === ''
      const be = bv === undefined || bv === null || bv === ''
      if (ae !== be) return ae ? 1 : -1 // empties last in both directions
      if (!ae) {
        const c = String(av).localeCompare(String(bv), undefined, { numeric: true })
        if (c !== 0) return sign * c
      }
      return a.path.localeCompare(b.path)
    })
  }
  const notes = spec.limit === undefined ? sorted : sorted.slice(0, spec.limit)

  let groups: QueryGroupResult[] | null = null
  if (spec.groupBy) {
    const key = spec.groupBy
    const buckets = new Map<string, QueryNote[]>()
    for (const n of notes) {
      const labels =
        key === 'tag'
          ? n.tags.length
            ? n.tags.map((t) => `#${t}`)
            : ['Untagged']
          : key === 'date'
            ? [n.date ?? 'No date']
            : key === 'status'
              ? [n.todo > 0 ? 'To do' : n.done > 0 ? 'Done' : 'Notes']
              : [n.name]
      for (const label of labels) {
        const arr = buckets.get(label)
        if (arr) arr.push(n)
        else buckets.set(label, [n])
      }
    }
    groups = [...buckets].map(([label, ns]) => ({ label, blocks: [], notes: ns }))
  }
  return { spec, blocks: [], notes, groups, total: matched.length }
}
