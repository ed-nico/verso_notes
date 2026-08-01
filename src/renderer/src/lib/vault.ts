import type { LinkRef, ParsedNote } from '@shared/types'
import { FILE_LINK_RE } from '@shared/media'
import { parseFrontmatter } from './frontmatter'
import { basename, stripMd } from './links'
import { codeRanges, escapeRegExp, inRanges } from './md'
import { contextBlockForLink } from './parse'
import {
  matchBlock,
  parseQuery,
  scanBlocks,
  shapeResults,
  type QueryBlock,
  type QueryResult
} from './query'

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
  /** Generation counter, bumped by each successful `withContentChanges` patch.
   *  Handles sharing derived state share a version (see that method's contract). */
  version = 0
  /** path -> parsed note (canonical note set). */
  private notesByPath = new Map<string, ParsedNote>()
  private paths: string[] = []
  /** resolved target path -> backlinks pointing at it. */
  private backlinks = new Map<string, RawBacklink[]>()
  /** source path -> set of target paths it contributes backlinks to (for incremental removal). */
  private targetsBySource = new Map<string, Set<string>>()
  /** resolved target path -> number of distinct source notes (precomputed). */
  private backlinkCounts = new Map<string, number>()
  /** path -> queryable blocks (for `{{query}}`), kept per-note so edits patch one entry.
   *  Filled LAZILY: see `blocksFor`. */
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
      for (const t of this.addNoteLinks(note)) affected.add(t)
    }
    this.recount(affected)
  }

  /**
   * Queryable blocks for one note, scanned on first use.
   *
   * These are needed only by `{{query}}`, but the constructor used to scan every
   * note up front — a second full pass over the vault (each note re-parsing its
   * own YAML frontmatter) on top of the one `parseNote` already did, paid at
   * startup by every user whether or not their vault contains a single query.
   * `scanBlocks` additionally memoizes by (path, text), so a note scanned under
   * one index generation stays cheap in the next.
   */
  private blocksFor(path: string): QueryBlock[] {
    const hit = this.blocksByPath.get(path)
    if (hit) return hit
    const note = this.notesByPath.get(path)
    if (!note) return []
    const blocks = scanBlocks(path, note.name, this.texts[path] ?? '')
    this.blocksByPath.set(path, blocks)
    return blocks
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
   * Patch the index for content edits to `changed` (a body/frontmatter change to
   * notes that already exist — the file set is unchanged). Only the changed notes
   * are re-derived; every other note's backlinks/blocks are reused, turning the
   * per-keystroke rebuild from O(vault) into O(edited notes).
   *
   * Returns null when it can't safely patch (an unknown path, or aliases changed so
   * other notes' links may now resolve differently) — the caller then full-rebuilds.
   *
   * SHARED-STATE CONTRACT. The returned handle is a fresh object (so zustand/React
   * see a changed identity) but it ALIASES this one's derived maps — not copying
   * them is exactly what makes the patch O(edited notes). So this is not a snapshot
   * API: after a successful call, the receiver and the result are the same index,
   * and the previous handle is *superseded*, not preserved. Never hold an index
   * across a rebuild expecting frozen data; read `version` if you need to tell
   * generations apart.
   *
   * (Prior versions cloned FIRST and then mutated a mix of `this` and `next`, so
   * the two handles disagreed: `next` got a cleared `unlinkedCache` while `this`
   * kept stale entries pointing at re-derived notes. Everything below mutates
   * `this` and clones last, so the two can never diverge.)
   */
  withContentChanges(changed: ParsedNote[], texts: Record<string, string>): VaultIndex | null {
    for (const note of changed) {
      if (!this.notesByPath.has(note.path)) return null // a new file — file set changed
      if (!sameAliases(this.notesByPath.get(note.path)!, note)) return null // resolution may shift
    }
    this.texts = texts
    const affected = new Set<string>()
    for (const note of changed) {
      for (const t of this.removeNoteLinks(note.path)) affected.add(t)
      this.notesByPath.set(note.path, note)
      this.blocksByPath.delete(note.path) // re-scanned on demand by blocksFor
      for (const t of this.addNoteLinks(note)) affected.add(t)
      // Editing a note changes only the mentions found INSIDE it — its name (and
      // so every other note's mentions of it) is fixed for this index's lifetime.
      this.staleMentions.add(note.path)
    }
    // The target-keyed view is regrouped from scratch on next request; that's
    // O(total mentions), not another pass over the vault's text.
    this.unlinkedByTarget = null
    this.recount(affected)
    this.version++
    // Clone LAST, so every field (texts, version, caches) is copied post-mutation.
    return Object.assign(Object.create(VaultIndex.prototype), this) as VaultIndex
  }

  /** Run a `{{query ...}}` against every block in the vault, applying its
   *  `sort:` / `limit:` / `group:` directives. */
  runQuery(raw: string): QueryResult {
    const spec = parseQuery(raw)
    if (spec.empty) return { spec, blocks: [], groups: null, total: 0 }
    const out: QueryBlock[] = []
    for (const path of this.notesByPath.keys()) {
      for (const b of this.blocksFor(path)) if (matchBlock(b, spec)) out.push(b)
    }
    return shapeResults(out, spec)
  }

  /** Just the shaped block list — the common case. */
  query(raw: string): QueryBlock[] {
    return this.runQuery(raw).blocks
  }

  private rawBacklinks(path: string): RawBacklink[] {
    return this.backlinks.get(path) ?? []
  }

  backlinksFor(path: string): Backlink[] {
    // Context is resolved here (lazily) — only for the handful of links pointing
    // at the note actually being viewed, not for every link in the vault.
    // A source that links here several times gets each row its OWN line: we count
    // occurrences per (source, raw target) and ask for the nth match.
    const occ = new Map<string, number>()
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
      const key = `${bl.sourcePath}\n${bl.ref.raw.toLowerCase()}`
      const n = occ.get(key) ?? 0
      occ.set(key, n + 1)
      // Whole-unit context (list item + children, paragraph, heading section) —
      // a single windowed line rarely carries the meaning of the mention.
      const ctx = contextBlockForLink(this.texts[bl.sourcePath] ?? '', bl.ref.raw, n)
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

  // ---- unlinked references -------------------------------------------------
  // Plain-text mentions of a note's name in OTHER notes, not wrapped in [[ ]].
  //
  // The old shape was "scan the whole vault for one target name, memoize per
  // target, throw the memo away on every index generation". With the backlinks
  // panel open that meant a full-vault YAML-parse + regex pass every ~200ms of
  // typing. This version instead scans each SOURCE note once for ALL names at
  // once (one combined alternation, as tend.ts already did), keyed by source —
  // so a content edit re-scans exactly the note you typed in, and the target
  // view is regrouped in O(mentions) rather than O(vault text).

  /** Combined `name1|name2|…` matcher, built once per index (the name set is
   *  fixed for an index's lifetime — a rename changes the file set, which forces
   *  a full rebuild rather than a patch). */
  private mentionRe: RegExp | null = null
  /** lowercased note name -> every path carrying it (duplicate basenames all match). */
  private byNameLower = new Map<string, string[]>()
  /** source path -> unlinked mentions found in it. Filled lazily, per note. */
  private mentionsBySource = new Map<string, Backlink[]>()
  /** Sources whose cached scan is out of date (their text changed). */
  private staleMentions = new Set<string>()
  /** target path -> mentions of it, regrouped from `mentionsBySource`. Null = needs rebuild. */
  private unlinkedByTarget: Map<string, Backlink[]> | null = null

  /** Build (once) the combined name matcher and the name -> paths lookup. */
  private ensureMentionRe(): RegExp | null {
    if (this.mentionRe) return this.mentionRe
    this.byNameLower.clear()
    for (const n of this.notesByPath.values()) {
      if (!n.name) continue // an empty alternative would match everywhere
      const k = n.name.toLowerCase()
      const arr = this.byNameLower.get(k)
      if (arr) arr.push(n.path)
      else this.byNameLower.set(k, [n.path])
    }
    const names = [...this.byNameLower.keys()]
    if (!names.length) return null
    const alt = names
      .map(escapeRegExp)
      .sort((a, b) => b.length - a.length) // longest first, so "Deep Work" beats "Work"
      .join('|')
    // Left boundary excludes `#` so a #tag carrying the name isn't a "mention".
    // The right boundary is a LOOKAHEAD (not a consumed char) so back-to-back
    // mentions — "Alpha Beta" — both match under the global regex.
    this.mentionRe = new RegExp(`(^|[^\\w[/#])(${alt})(?![\\w\\]/])`, 'gi')
    return this.mentionRe
  }

  /** Every unlinked mention appearing IN `sourcePath`, one row per (target, line).
   *  Mentions inside `#tags`, code (fenced or inline), or frontmatter don't count:
   *  linking those would corrupt them (frontmatter/code) or double-mark them (tags). */
  private scanMentions(sourcePath: string): Backlink[] {
    const re = this.ensureMentionRe()
    const out: Backlink[] = []
    if (!re) return out
    const sourceName = this.nameByPath.get(sourcePath) ?? sourcePath
    const { body, bodyLine } = parseFrontmatter(this.texts[sourcePath] ?? '')
    const skip = codeRanges(body)
    const lines = body.split('\n')
    let offset = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineStart = offset
      offset += line.length + 1
      // Skip lines inside fenced code blocks.
      const firstCh = line.search(/\S/)
      if (firstCh === -1) continue
      if (inRanges(lineStart + firstCh, skip)) continue
      // A name only appearing inside a wikilink or inline code isn't a mention.
      const stripped = line.replace(/\[\[[^\]\n]*\]\]/g, '').replace(/`[^`\n]+`/g, '')
      if (!stripped.trim()) continue
      let seen: Set<string> | null = null // one row per target per line
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(stripped))) {
        const targets = this.byNameLower.get(m[2].toLowerCase())
        if (!targets) continue
        for (const target of targets) {
          if (target === sourcePath) continue
          seen ??= new Set<string>()
          if (seen.has(target)) continue
          seen.add(target)
          out.push({
            sourcePath,
            sourceName,
            ref: { target, raw: this.nameByPath.get(target) ?? '' },
            context: line,
            line: bodyLine + i
          })
        }
      }
    }
    return out
  }

  /** Logseq-style "unlinked references": notes mentioning `path` by name without linking. */
  unlinkedReferences(path: string): Backlink[] {
    if (!this.notesByPath.has(path)) return []
    if (!this.unlinkedByTarget) {
      // Scan only what's missing or stale; `set` on an existing key keeps its Map
      // position, so the source ordering of results stays stable across patches.
      for (const p of this.notesByPath.keys()) {
        if (!this.mentionsBySource.has(p) || this.staleMentions.has(p)) {
          this.mentionsBySource.set(p, this.scanMentions(p))
        }
      }
      this.staleMentions.clear()
      const byTarget = new Map<string, Backlink[]>()
      for (const list of this.mentionsBySource.values()) {
        for (const bl of list) {
          const key = bl.ref.target!
          const arr = byTarget.get(key)
          if (arr) arr.push(bl)
          else byTarget.set(key, [bl])
        }
      }
      this.unlinkedByTarget = byTarget
    }
    return this.unlinkedByTarget.get(path) ?? []
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
      if (!resolved && FILE_LINK_RE.test(ref.raw)) continue // asset embed, not a note
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
        if (!resolved && FILE_LINK_RE.test(ref.raw)) continue // asset embed, not a note
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
