/**
 * The Tend view's serendipity/garden report: suggested connections (notes whose
 * names co-occur without links), orphans, stubs, stale notes, and broken links.
 * Pure functions over the store's files/parsed/texts; the caller supplies the
 * index-backed resolver + backlink counts so this stays testable.
 */
import type { NoteFile, ParsedNote } from '@shared/types'
import { parseFrontmatter } from './frontmatter'
import { codeRanges, inRanges } from './md'
import { basename } from './links'
import { noteStats } from './stats'

/** A note that other notes mention by name without linking to it. */
export interface Suggestion {
  path: string
  name: string
  /** Paths of the notes mentioning it (each with no link in either direction). */
  sources: string[]
}

/** An unresolved wikilink target and the notes that reference it. */
export interface BrokenLink {
  raw: string
  sources: string[]
}

export interface TendReport {
  suggestions: Suggestion[]
  /** No outgoing links and no backlinks. */
  orphans: NoteFile[]
  /** Fewer than STUB_WORDS words of content. */
  stubs: NoteFile[]
  /** Untouched for STALE_DAYS+, oldest first. */
  stale: NoteFile[]
  broken: BrokenLink[]
}

/** Folders whose notes are structural, not garden content (templates, supertag
 *  definitions, journal days) — excluded as targets/orphans/stubs, though a
 *  journal day still counts as a mention *source*. */
const SKIP_DIRS = /^(Templates|Tags)\//
const JOURNAL_DIR = /^Daily\//
/** Link targets that are files, not notes (mirrors vault.ts's embed filter). */
const FILE_LINK_RE = /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|mp3|wav|m4a|pdf|canvas)$/i
/** Names shorter than this are too ambiguous to suggest linking ("A", "Go"). */
const MIN_NAME_LEN = 3
const STUB_WORDS = 20
const STALE_DAYS = 90

export function tendReport(
  files: NoteFile[],
  parsed: Record<string, ParsedNote>,
  texts: Record<string, string>,
  resolve: (raw: string) => string | null,
  backlinkCount: (path: string) => number,
  now: number
): TendReport {
  const notes = files.filter((f) => !SKIP_DIRS.test(f.path))

  // Resolved outgoing note-links per note, for connectivity checks.
  const out = new Map<string, Set<string>>()
  for (const f of files) {
    const set = new Set<string>()
    for (const ref of parsed[f.path]?.links ?? []) {
      const t = resolve(ref.raw)
      if (t && t !== f.path) set.add(t)
    }
    out.set(f.path, set)
  }
  const connected = (a: string, b: string): boolean => !!out.get(a)?.has(b) || !!out.get(b)?.has(a)

  const suggestions = suggestConnections(files, texts, connected)

  const orphans: NoteFile[] = []
  const stubs: NoteFile[] = []
  const stale: NoteFile[] = []
  const staleBefore = now - STALE_DAYS * 24 * 60 * 60 * 1000
  for (const f of notes) {
    if (JOURNAL_DIR.test(f.path)) continue // journal days are naturally standalone
    if (out.get(f.path)!.size === 0 && backlinkCount(f.path) === 0) orphans.push(f)
    if (noteStats(texts[f.path] ?? '').words < STUB_WORDS) stubs.push(f)
    if (f.mtime > 0 && f.mtime < staleBefore) stale.push(f)
  }
  stale.sort((a, b) => a.mtime - b.mtime)

  // Broken links: body/frontmatter wikilinks that resolve to nothing — except
  // asset embeds and ISO dates (an unresolved [[2026-08-01]] is a future journal
  // day that will be created on click, not a mistake).
  const brokenBy = new Map<string, BrokenLink>()
  for (const f of files) {
    if (f.path.startsWith('Templates/')) continue // template links are placeholders
    for (const ref of parsed[f.path]?.links ?? []) {
      if (!ref.raw || resolve(ref.raw) !== null) continue
      if (FILE_LINK_RE.test(ref.raw) || /^\d{4}-\d{2}-\d{2}$/.test(ref.raw)) continue
      const key = ref.raw.toLowerCase()
      const entry = brokenBy.get(key) ?? { raw: ref.raw, sources: [] }
      if (!entry.sources.includes(f.path)) entry.sources.push(f.path)
      brokenBy.set(key, entry)
    }
  }
  const broken = [...brokenBy.values()].sort(
    (a, b) => b.sources.length - a.sources.length || a.raw.localeCompare(b.raw)
  )

  return { suggestions, orphans, stubs, stale, broken }
}

/**
 * Find notes mentioned by name in other notes with no link in either direction.
 * One combined-alternation scan per note (not a per-pair scan, which is O(n²)
 * regex passes over the vault). Mention rules mirror VaultIndex.unlinkedReferences:
 * frontmatter, code (fenced + inline), #tags, and existing [[wikilinks]] don't count.
 */
function suggestConnections(
  files: NoteFile[],
  texts: Record<string, string>,
  connected: (a: string, b: string) => boolean
): Suggestion[] {
  // Candidate targets: real content notes with usably distinctive names.
  const byName = new Map<string, NoteFile>() // lowercased name -> note
  for (const f of files) {
    if (SKIP_DIRS.test(f.path) || JOURNAL_DIR.test(f.path)) continue
    if (f.name.length < MIN_NAME_LEN || /^\d{4}-\d{2}-\d{2}$/.test(f.name)) continue
    const k = f.name.toLowerCase()
    // Duplicate basenames are ambiguous mentions — skip the name entirely.
    if (byName.has(k)) byName.delete(k)
    else byName.set(k, f)
  }
  if (byName.size === 0) return []
  const alternation = [...byName.values()]
    .map((f) => f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length) // longest first, so "Deep Work" beats "Work"
    .join('|')
  // Boundaries as in unlinkedReferences: no word/tag/link chars on either side.
  const re = new RegExp(`(^|[^\\w[/#])(${alternation})(?![\\w\\]/])`, 'gi')

  const mentions = new Map<string, Set<string>>() // target path -> source paths
  for (const src of files) {
    if (src.path.startsWith('Templates/')) continue
    const text = texts[src.path] ?? ''
    const { body } = parseFrontmatter(text)
    const skip = codeRanges(body)
    const lines = body.split('\n')
    let offset = 0
    for (const line of lines) {
      const lineStart = offset
      offset += line.length + 1
      const firstCh = line.search(/\S/)
      if (firstCh !== -1 && inRanges(lineStart + firstCh, skip)) continue
      // A name inside an existing [[wikilink]] or `inline code` isn't a mention.
      const stripped = line.replace(/\[\[[^\]\n]*\]\]/g, '').replace(/`[^`\n]+`/g, '')
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(stripped))) {
        const target = byName.get(m[2].toLowerCase())
        if (!target || target.path === src.path || connected(src.path, target.path)) continue
        const set = mentions.get(target.path) ?? new Set<string>()
        set.add(src.path)
        mentions.set(target.path, set)
      }
    }
  }

  return [...mentions.entries()]
    .map(([path, sources]) => ({ path, name: basename(path), sources: [...sources] }))
    .sort((a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name))
}
