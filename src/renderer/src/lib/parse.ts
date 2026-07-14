import type { LinkRef, ParsedNote } from '@shared/types'
import { frontmatterAliases, frontmatterTags, isSystemProp, parseFrontmatter } from './frontmatter'
import { basename, parseTarget } from './links'
import { codeRanges, inRanges } from './md'

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g
// A tag needs at least one letter (the lookahead), so `#2024` is a plain number
// reference, not a tag — while `#2024-goals` and `#y2024/q1` still qualify.
export const TAG_RE = /(^|[\s(])#(?=[\d_/-]*\p{L})([\p{L}\d_][\p{L}\d_/-]*)/gu

/** Parse a single wikilink body "target|alias" into a LinkRef (unresolved). */
function parseLinkBody(body: string): LinkRef {
  const pipe = body.indexOf('|')
  const linkPart = pipe === -1 ? body : body.slice(0, pipe)
  // An empty alias (`[[Note|]]`) is normalized to undefined so downstream code,
  // which treats `alias` as optional, behaves consistently.
  const alias = pipe === -1 ? undefined : body.slice(pipe + 1).trim() || undefined
  return {
    target: null, // resolved later against the vault file list
    raw: parseTarget(linkPart).page,
    alias
  }
}

export function parseNote(path: string, text: string): ParsedNote {
  const { data, body, bodyLine } = parseFrontmatter(text)
  const skip = codeRanges(body)

  // --- Wikilinks ---
  const links: LinkRef[] = []
  // Frontmatter `[[wikilinks]]` first — these are typed relationships (e.g.
  // `author: [[Mara Lindqvist]]`) that should feed backlinks + graph like body
  // links, but carry the property key so the UI can label them.
  links.push(...frontmatterLinks(data))
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(body))) {
    if (inRanges(m.index, skip)) continue
    links.push(parseLinkBody(m[1]))
  }

  // --- Tags: inline #tags (skip code) merged with frontmatter `tags:` ---
  // "# Heading" is excluded because TAG_RE needs a word char right after #.
  const inline = new Set<string>()
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(body))) {
    if (inRanges(m.index, skip)) continue
    inline.add(m[2])
  }
  // Merge, de-duplicating case-insensitively (inline form wins).
  const seen = new Set<string>()
  const tags: string[] = []
  for (const t of [...inline, ...frontmatterTags(data)]) {
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    tags.push(t)
  }

  // --- Excerpt: first meaningful body line ---
  const lines = body.split('\n')
  let excerpt = ''
  for (const line of lines) {
    const t = line.trim()
    // Skip blanks, headings and rules — but NOT tag lines: `#work meeting notes`
    // is content (a heading needs whitespace after the #s).
    if (t === '' || /^#{1,6}\s/.test(t) || /^#{1,6}$/.test(t) || t.startsWith('---')) continue
    excerpt = t.replace(/[*_`>]/g, '').slice(0, 140)
    break
  }

  return {
    path,
    name: basename(path),
    frontmatter: data,
    links,
    aliases: frontmatterAliases(data),
    tags,
    excerpt
  }
}

/**
 * Pull `[[wikilinks]]` out of frontmatter property values (strings, or arrays/
 * comma-strings of them) as typed relationships. Each LinkRef records the `prop`
 * it came from. System keys (`_`-prefixed) and the alias/tag keys are skipped.
 */
function frontmatterLinks(data: Record<string, unknown>): LinkRef[] {
  const out: LinkRef[] = []
  const SKIP = new Set(['aliases', 'alias', 'tags'])
  for (const [key, value] of Object.entries(data)) {
    if (isSystemProp(key) || SKIP.has(key)) continue
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v !== 'string') continue
      let mm: RegExpExecArray | null
      WIKILINK_RE.lastIndex = 0
      while ((mm = WIKILINK_RE.exec(v))) {
        const ref = parseLinkBody(mm[1])
        ref.prop = key
        out.push(ref)
      }
    }
  }
  return out
}

/**
 * Find the line surrounding a link to `rawPage`, for backlink context + editing.
 * Returns the raw line text and its full-text line index (or line -1 if none).
 * Code-aware (a `[[link]]` inside a fence or inline span isn't a link — the
 * parser never indexed it, so it must not be offered as context either), and
 * `occurrence` selects the nth real link when a note links to the page several
 * times, so each backlink row shows ITS line, not the first one over and over.
 */
export function contextForLink(
  text: string,
  rawPage: string,
  occurrence = 0
): { text: string; line: number } {
  const { body, bodyLine } = parseFrontmatter(text)
  const skip = codeRanges(body)
  const lines = body.split('\n')
  const needle = rawPage.toLowerCase()
  let seen = 0
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offset
    offset += lines[i].length + 1
    let mm: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((mm = WIKILINK_RE.exec(lines[i]))) {
      if (inRanges(lineStart + mm.index, skip)) continue
      if (parseTarget(mm[1].split('|')[0]).page.toLowerCase() === needle) {
        if (seen === occurrence) return { text: lines[i], line: bodyLine + i }
        seen++
      }
    }
  }
  return { text: '', line: -1 }
}

/** Longest block-context shown per backlink (lines); deeper content is elided. */
const MAX_CTX_LINES = 6

/**
 * Like contextForLink, but returns the whole UNIT OF MEANING around the nth
 * link (Reflect-style): a list item with its continuation/children (plus its
 * parent item's own line), a heading with the start of its section, or the full
 * paragraph — instead of one windowed line. Multi-line, capped at MAX_CTX_LINES
 * with a trailing ellipsis; `line` remains the matched line for jumping.
 */
export function contextBlockForLink(
  text: string,
  rawPage: string,
  occurrence = 0
): { text: string; line: number } {
  const hit = contextForLink(text, rawPage, occurrence)
  if (hit.line < 0) return hit
  const { body, bodyLine } = parseFrontmatter(text)
  const lines = body.split('\n')
  const i = hit.line - bodyLine
  if (i < 0 || i >= lines.length) return hit

  const indentOf = (l: string): number => l.match(/^\s*/)![0].length
  const isListLine = (l: string): boolean => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)
  const isHeadingLine = (l: string): boolean => /^#{1,6}\s/.test(l)
  const isBoundary = (l: string): boolean =>
    isListLine(l) || isHeadingLine(l) || /^\s{0,3}(?:`{3,}|~{3,})/.test(l)

  let start = i
  let end = i + 1 // exclusive
  if (isListLine(lines[i])) {
    // The item + everything nested under it (continuations and children)…
    const base = indentOf(lines[i])
    while (end < lines.length && lines[end].trim() !== '' && indentOf(lines[end]) > base) end++
    // …plus the parent item's own line, for orientation.
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].trim() === '') break
      if (isListLine(lines[j]) && indentOf(lines[j]) < base) {
        start = j
        break
      }
      if (indentOf(lines[j]) < base) break
    }
  } else if (isHeadingLine(lines[i])) {
    // The heading and the start of its section (up to the cap).
    while (end < lines.length && !isHeadingLine(lines[end]) && end - i < MAX_CTX_LINES) end++
  } else {
    // Paragraph: expand to the contiguous non-blank run around the line,
    // stopping at list/heading/fence boundaries.
    while (start > 0 && lines[start - 1].trim() !== '' && !isBoundary(lines[start - 1])) start--
    while (end < lines.length && lines[end].trim() !== '' && !isBoundary(lines[end])) end++
  }

  let unit = lines.slice(start, end).filter((l) => l.trim() !== '')
  if (unit.length > MAX_CTX_LINES) unit = [...unit.slice(0, MAX_CTX_LINES), '…']
  return { text: unit.join('\n'), line: hit.line }
}
