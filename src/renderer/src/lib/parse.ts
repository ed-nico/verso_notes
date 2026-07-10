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
    if (t === '' || t.startsWith('#') || t.startsWith('---')) continue
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
 */
export function contextForLink(text: string, rawPage: string): { text: string; line: number } {
  const { body, bodyLine } = parseFrontmatter(text)
  const lines = body.split('\n')
  const needle = rawPage.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    let mm: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((mm = WIKILINK_RE.exec(lines[i]))) {
      if (parseTarget(mm[1].split('|')[0]).page.toLowerCase() === needle) {
        return { text: lines[i], line: bodyLine + i }
      }
    }
  }
  return { text: '', line: -1 }
}
