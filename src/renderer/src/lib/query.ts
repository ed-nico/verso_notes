/**
 * The block query language for `{{query ...}}` blocks.
 *
 * Grammar (v2):
 *   query      :=  group ("OR" group)*          — OR groups; any group matching wins
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

export interface QuerySpec {
  /** OR-groups; a block matches when EVERY atom of ANY group passes. */
  groups: QueryGroup[]
  /** True when no criteria were given (matches nothing rather than everything). */
  empty: boolean
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
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    if (tok === 'OR') {
      if (cur().atoms.length) groups.push({ atoms: [] })
      continue
    }
    const atom = parseToken(tok, links)
    if (atom) cur().atoms.push(atom)
  }

  const kept = groups.filter((g) => g.atoms.length > 0)
  return { groups: kept, empty: kept.length === 0 }
}

function parseToken(tok: string, links: { negated: boolean; page: string }[]): Atom | null {
  // Wikilink placeholder (carries its own negation flag).
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
