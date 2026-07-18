/**
 * Compile mode: stitch a hub note and the notes it links to — recursively, in
 * reading order — into one linear Markdown document (Scrivener-style assembly
 * of a mesh of atomic notes). Pure functions; the caller supplies texts/parsed
 * and a link resolver, so this stays testable and store-agnostic.
 */
import type { ParsedNote } from '@shared/types'
import { parseFrontmatter } from './frontmatter'
import { basename } from './links'
import { codeRanges, inRanges } from './md'

export interface CompileSection {
  path: string
  name: string
  /** Link-hops from the hub note (0 = the hub itself). */
  depth: number
  /** This note's compiled markdown: a title heading + its adjusted body. */
  markdown: string
}

export interface CompileOptions {
  /** How many link-hops to follow from the hub (1 = only its direct links). */
  maxDepth?: number
  /** Hard cap on included notes — a hub-of-everything must not compile the vault. */
  maxNotes?: number
  /** Replace `[[wikilinks]]` with their display text, for use outside the vault. */
  flattenLinks?: boolean
}

/**
 * Depth-first, pre-order walk from `hubPath` following body wikilinks in the
 * order they appear (frontmatter relationship links are metadata, not narrative
 * flow, so they're skipped). Each note is included once — the first time it's
 * reached — which also makes link cycles safe.
 */
export function compileNote(
  hubPath: string,
  texts: Record<string, string>,
  parsed: Record<string, ParsedNote>,
  resolve: (raw: string) => string | null,
  opts: CompileOptions = {}
): CompileSection[] {
  const maxDepth = opts.maxDepth ?? 2
  const maxNotes = opts.maxNotes ?? 100
  const visited = new Set<string>()
  const sections: CompileSection[] = []

  const visit = (path: string, depth: number): void => {
    if (visited.has(path) || sections.length >= maxNotes) return
    visited.add(path)
    const note = parsed[path]
    const name = note?.name ?? basename(path)
    sections.push({
      path,
      name,
      depth,
      markdown: sectionMarkdown(name, texts[path] ?? '', depth, !!opts.flattenLinks)
    })
    if (depth >= maxDepth) return
    for (const ref of note?.links ?? []) {
      if (ref.prop) continue // frontmatter relationship, not part of the text
      const target = resolve(ref.raw)
      if (target && target !== path) visit(target, depth + 1)
    }
  }
  visit(hubPath, 0)
  return sections
}

/** Join the (kept) sections into the final document. */
export function joinSections(sections: CompileSection[], excluded?: Set<string>): string {
  return sections
    .filter((s) => !excluded?.has(s.path))
    .map((s) => s.markdown)
    .join('\n\n')
}

/** One note's contribution: `#`-level title per depth, body headings demoted to
 *  nest beneath it, `^anchors` dropped, links optionally flattened. */
function sectionMarkdown(name: string, text: string, depth: number, flatten: boolean): string {
  let body = parseFrontmatter(text).body.trim()
  // Block anchors are vault plumbing — they'd read as noise in a linear document.
  body = body.replace(/\s\^[A-Za-z0-9-]+(?=\s|$)/g, '')
  body = shiftHeadings(body, depth + 1)
  if (flatten) body = flattenLinks(body)
  const title = '#'.repeat(Math.min(depth + 1, 6)) + ' ' + name
  return body ? `${title}\n\n${body}` : title
}

/** Demote every heading outside code fences by `by` levels (capped at h6). */
function shiftHeadings(body: string, by: number): string {
  if (by <= 0) return body
  const skip = codeRanges(body)
  const lines = body.split('\n')
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const start = offset
    offset += lines[i].length + 1
    const m = lines[i].match(/^(#{1,6})(\s)/)
    if (!m || inRanges(start, skip)) continue
    lines[i] = '#'.repeat(Math.min(m[1].length + by, 6)) + lines[i].slice(m[1].length)
  }
  return lines.join('\n')
}

/** Replace `[[target|alias]]` → alias and `[[target]]` → basename(target), leaving
 *  code spans/fences and `![[embeds]]` (images, PDFs) untouched. */
function flattenLinks(body: string): string {
  const skip = codeRanges(body)
  return body.replace(/\[\[([^\]\n]+?)\]\]/g, (whole, inner: string, offset: number) => {
    if (inRanges(offset, skip)) return whole
    if (offset > 0 && body[offset - 1] === '!') return whole // embed, not a prose link
    const pipe = inner.indexOf('|')
    if (pipe !== -1) return inner.slice(pipe + 1).trim() || basename(inner.slice(0, pipe))
    return basename(inner.replace(/[#^].*$/, '').trim())
  })
}
