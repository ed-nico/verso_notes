import type { LinkRef, ParsedNote } from '@shared/types'
import { basename, stripMd } from './links'
import { contextForLink } from './parse'
import { matchBlock, parseQuery, scanBlocks, type QueryBlock } from './query'

/** A single backlink: a source note that links to the current note. */
export interface Backlink {
  sourcePath: string
  sourceName: string
  ref: LinkRef
  /** The line of text where the link appears, for context. */
  context: string
  /** Full-text line index of the context in the source note (-1 if unknown). */
  line: number
}

/** Stored backlink — context is resolved lazily (it's only needed when displayed). */
interface RawBacklink {
  sourcePath: string
  sourceName: string
  ref: LinkRef
  excerpt: string
}

export interface GraphNode {
  id: string // path
  name: string
  /** Number of connections, for sizing. */
  degree: number
  /** True for an unresolved (not-yet-created) note. */
  phantom?: boolean
}

export interface GraphLink {
  source: string
  target: string
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

/**
 * The vault index resolves every note's outgoing links against the current
 * file set and exposes backlink + graph queries.
 *
 * Performance: link resolution uses precomputed basename/path maps (O(1) per
 * link instead of scanning every path), and backlink *context* is computed
 * lazily in backlinksFor() — only for the note being viewed — rather than for
 * every link in the vault on each rebuild.
 */
export class VaultIndex {
  /** path -> parsed note (canonical note set). */
  private notesByPath = new Map<string, ParsedNote>()
  private paths: string[] = []
  /** resolved target path -> backlinks pointing at it. */
  private backlinks = new Map<string, RawBacklink[]>()
  /** source path -> set of target paths it contributes backlinks to (for incremental removal). */
  private targetsBySource = new Map<string, Set<string>>()
  /** resolved target path -> number of distinct source notes (precomputed). */
  private backlinkCounts = new Map<string, number>()
  /** path -> queryable blocks (for `{{query}}`), kept per-note so edits patch one entry. */
  private blocksByPath = new Map<string, QueryBlock[]>()
  /** Note texts (by path), kept for unlinked-reference scanning + lazy context.
   *  Held by reference (not copied) — the store mutates this Record in place. */
  private texts: Record<string, string>
  /** name index for fast lookups. */
  private byFull = new Map<string, string>() // full path (no ext), lowercased -> path
  private byBase = new Map<string, string[]>() // basename lowercased -> paths (shortest first)
  private byAlias = new Map<string, string>() // frontmatter alias lowercased -> path
  private nameByPath = new Map<string, string>()

  constructor(notes: ParsedNote[], texts: Record<string, string>) {
    this.texts = texts
    for (const n of notes) {
      this.notesByPath.set(n.path, n)
      this.nameByPath.set(n.path, n.name)
    }
    this.paths = notes.map((n) => n.path)
    for (const p of this.paths) {
      this.byFull.set(stripMd(p).toLowerCase(), p)
      const b = basename(p).toLowerCase()
      const arr = this.byBase.get(b)
      if (arr) arr.push(p)
      else this.byBase.set(b, [p])
    }
    for (const arr of this.byBase.values()) arr.sort((a, b) => a.length - b.length)
    // Aliases resolve only when no real note claims that name (a real filename wins),
    // and first declaration wins on collision — so build this last and don't overwrite.
    for (const n of notes) {
      for (const a of n.aliases ?? []) {
        const k = a.toLowerCase()
        if (!this.byBase.has(k) && !this.byAlias.has(k)) this.byAlias.set(k, n.path)
      }
    }
    const affected = new Set<string>()
    for (const note of notes) {
      this.blocksByPath.set(note.path, scanBlocks(note.path, note.name, texts[note.path] ?? ''))
      for (const t of this.addNoteLinks(note)) affected.add(t)
    }
    this.recount(affected)
  }

  /** All notes (iteration order = insertion order). */
  private get notes(): IterableIterator<ParsedNote> {
    return this.notesByPath.values()
  }

  /** Resolve a raw link page to a path, O(1)-ish (same rules as links.resolvePage). */
  private resolve(page: string): string | null {
    if (page === '') return null
    if (page.includes('/')) return this.byFull.get(stripMd(page).toLowerCase()) ?? null
    const cands = this.byBase.get(page.toLowerCase())
    if (!cands) return this.byAlias.get(page.toLowerCase()) ?? null
    // exact-case wins (candidates are shortest-first, so the first exact match is the shortest)
    for (const p of cands) if (basename(p) === page) return p
    return cands[0] // shortest case-insensitive match
  }

  /** Public alias-aware resolution, for navigation + link styling in the renderer. */
  resolvePath(raw: string): string | null {
    return this.resolve(stripMd(raw.trim().replace(/[#^].*$/, '')))
  }

  /** Resolvable aliases across the vault, with their target note (for `[[` autocomplete). */
  aliasList(): { alias: string; path: string; name: string }[] {
    const out: { alias: string; path: string; name: string }[] = []
    for (const n of this.notesByPath.values()) {
      for (const a of n.aliases ?? []) {
        if (this.byAlias.get(a.toLowerCase()) === n.path) out.push({ alias: a, path: n.path, name: n.name })
      }
    }
    return out
  }

  /** Add `note`'s outgoing backlinks; returns the set of target paths it touched. */
  private addNoteLinks(note: ParsedNote): Set<string> {
    const targets = new Set<string>()
    for (const ref of note.links) {
      const resolved = this.resolve(ref.raw)
      if (!resolved || resolved === note.path) continue
      const list = this.backlinks.get(resolved) ?? []
      list.push({ sourcePath: note.path, sourceName: note.name, ref: { ...ref, target: resolved }, excerpt: note.excerpt })
      this.backlinks.set(resolved, list)
      targets.add(resolved)
    }
    this.targetsBySource.set(note.path, targets)
    return targets
  }

  /** Drop every backlink originating from `path`; returns the target paths it touched. */
  private removeNoteLinks(path: string): Set<string> {
    const targets = this.targetsBySource.get(path) ?? new Set<string>()
    for (const t of targets) {
      const list = this.backlinks.get(t)
      if (!list) continue
      const kept = list.filter((b) => b.sourcePath !== path)
      if (kept.length) this.backlinks.set(t, kept)
      else this.backlinks.delete(t)
    }
    this.targetsBySource.delete(path)
    return targets
  }

  /** Recompute distinct-source counts for just the given target paths. */
  private recount(targets: Set<string>): void {
    for (const t of targets) {
      const list = this.backlinks.get(t)
      if (!list || !list.length) this.backlinkCounts.delete(t)
      else this.backlinkCounts.set(t, new Set(list.map((b) => b.sourcePath)).size)
    }
  }

  /**
   * Produce a NEW index reflecting content edits to `changed` (a body/frontmatter
   * change to notes that already exist — the file set is unchanged). Only the
   * changed notes are re-derived; every other note's backlinks/blocks are reused,
   * turning the per-keystroke rebuild from O(vault) into O(edited notes).
   *
   * Returns null when it can't safely patch (an unknown path, or aliases changed so
   * other notes' links may now resolve differently) — the caller then full-rebuilds.
   */
  withContentChanges(changed: ParsedNote[], texts: Record<string, string>): VaultIndex | null {
    for (const note of changed) {
      if (!this.notesByPath.has(note.path)) return null // a new file — file set changed
      if (!sameAliases(this.notesByPath.get(note.path)!, note)) return null // resolution may shift
    }
    // Share the file-set-derived maps (unchanged) and mutate the per-note derived
    // structures in place — the old index is discarded by the caller, so in-place
    // mutation is safe and avoids copying the whole vault's backlinks.
    const next: VaultIndex = Object.assign(Object.create(VaultIndex.prototype), this)
    next.texts = texts
    const affected = new Set<string>()
    for (const note of changed) {
      for (const t of this.removeNoteLinks(note.path)) affected.add(t)
      this.notesByPath.set(note.path, note)
      this.blocksByPath.set(note.path, scanBlocks(note.path, note.name, texts[note.path] ?? ''))
      for (const t of this.addNoteLinks(note)) affected.add(t)
    }
    this.recount(affected)
    return next
  }

  /** Run a `{{query ...}}` against every block in the vault. */
  query(raw: string): QueryBlock[] {
    const spec = parseQuery(raw)
    if (spec.empty) return []
    const out: QueryBlock[] = []
    for (const blocks of this.blocksByPath.values()) {
      for (const b of blocks) if (matchBlock(b, spec)) out.push(b)
    }
    return out
  }

  private rawBacklinks(path: string): RawBacklink[] {
    return this.backlinks.get(path) ?? []
  }

  backlinksFor(path: string): Backlink[] {
    // Context is resolved here (lazily) — only for the handful of links pointing
    // at the note actually being viewed, not for every link in the vault.
    return this.rawBacklinks(path).map((bl) => {
      // A frontmatter relationship (`author: [[…]]`) has no body line to jump to —
      // label it by its property instead of hunting for context in the body.
      if (bl.ref.prop) {
        return {
          sourcePath: bl.sourcePath,
          sourceName: bl.sourceName,
          ref: bl.ref,
          context: `${bl.ref.prop}: [[${bl.ref.raw}]]`,
          line: -1
        }
      }
      const ctx = contextForLink(this.texts[bl.sourcePath] ?? '', bl.ref.raw)
      return {
        sourcePath: bl.sourcePath,
        sourceName: bl.sourceName,
        ref: bl.ref,
        context: ctx.text.trim() || bl.excerpt,
        line: ctx.line
      }
    })
  }

  /** Unique source paths linking to `path`. */
  backlinkCount(path: string): number {
    return this.backlinkCounts.get(path) ?? 0
  }

  /**
   * Plain-text mentions of this note's name in other notes that are NOT wrapped
   * in a `[[wikilink]]` — Logseq-style "unlinked references".
   */
  unlinkedReferences(path: string): Backlink[] {
    const note = this.notesByPath.get(path)
    if (!note) return []
    const esc = note.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\w[/])(${esc})([^\\w\\]/]|$)`, 'i')
    const out: Backlink[] = []
    for (const n of this.notes) {
      if (n.path === path) continue
      const text = this.texts[n.path] ?? ''
      // Cheap pre-filter: skip notes that don't contain the name at all.
      if (!re.test(text)) continue
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Ignore the name when it only appears inside a wikilink on this line.
        const stripped = lines[i].replace(/\[\[[^\]\n]*\]\]/g, '')
        if (!re.test(stripped)) continue
        out.push({
          sourcePath: n.path,
          sourceName: n.name,
          ref: { target: path, raw: note.name },
          context: lines[i],
          line: i
        })
      }
    }
    return out
  }

  /**
   * Graph of just the notes directly connected to `path` (its outgoing links
   * and its backlinks), centred on `path` — for the editor's local-graph panel.
   */
  localGraph(path: string): GraphData {
    const nameOf = (p: string): string => this.nameByPath.get(p) ?? p
    const nodes = new Map<string, GraphNode>()
    const seen = new Set<string>()
    const links: GraphLink[] = []
    const add = (id: string, name: string, phantom = false): void => {
      if (!nodes.has(id)) nodes.set(id, { id, name, degree: 0, phantom })
    }
    const edge = (source: string, target: string): void => {
      const key = source < target ? `${source}\n${target}` : `${target}\n${source}`
      if (seen.has(key)) return
      seen.add(key)
      links.push({ source, target })
      nodes.get(source)!.degree++
      nodes.get(target)!.degree++
    }
    add(path, nameOf(path))

    const center = this.notesByPath.get(path)
    for (const ref of center?.links ?? []) {
      if (!ref.raw) continue
      const resolved = this.resolve(ref.raw)
      if (resolved === path) continue
      const id = resolved ?? `phantom:${ref.raw}`
      add(id, resolved ? nameOf(resolved) : ref.raw, !resolved)
      edge(path, id)
    }
    for (const bl of this.rawBacklinks(path)) {
      add(bl.sourcePath, bl.sourceName)
      edge(bl.sourcePath, path)
    }
    return { nodes: [...nodes.values()], links }
  }

  /** Build force-graph data: resolved notes plus phantom nodes for unresolved links. */
  graph(): GraphData {
    const nodes = new Map<string, GraphNode>()
    const links: GraphLink[] = []

    for (const note of this.notes) {
      nodes.set(note.path, { id: note.path, name: note.name, degree: 0 })
    }

    for (const note of this.notes) {
      for (const ref of note.links) {
        if (!ref.raw) continue
        const resolved = this.resolve(ref.raw)
        const targetId = resolved ?? `phantom:${ref.raw}`
        if (!resolved && !nodes.has(targetId)) {
          nodes.set(targetId, { id: targetId, name: ref.raw, degree: 0, phantom: true })
        }
        if (resolved === note.path) continue
        links.push({ source: note.path, target: targetId })
        nodes.get(note.path)!.degree++
        nodes.get(targetId)!.degree++
      }
    }

    return { nodes: [...nodes.values()], links }
  }
}

/** True if two parsed notes declare the same alias set (order-insensitive). Changing
 *  a note's aliases can change how *other* notes' links resolve, so an alias change
 *  forces a full index rebuild rather than an incremental patch. */
function sameAliases(a: ParsedNote, b: ParsedNote): boolean {
  const x = a.aliases ?? []
  const y = b.aliases ?? []
  if (x.length !== y.length) return false
  const s = new Set(x.map((v) => v.toLowerCase()))
  return y.every((v) => s.has(v.toLowerCase()))
}
