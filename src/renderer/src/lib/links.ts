/** Wikilink target resolution, Obsidian-style. */
import { codeRanges, inRanges } from './md'

/** Strip the .md extension (case-insensitive). */
export function stripMd(p: string): string {
  return p.replace(/\.md$/i, '')
}

/** Filename without directory or extension. */
export function basename(p: string): string {
  const noExt = stripMd(p)
  const i = noExt.lastIndexOf('/')
  return i === -1 ? noExt : noExt.slice(i + 1)
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

/** Parsed pieces of a raw wikilink target. Only the page is used; any `#heading`
 *  or `^block` suffix is stripped so the page resolves cleanly. */
interface ParsedTarget {
  /** The note part, e.g. "Folder/Note" (no extension). */
  page: string
}

export function parseTarget(raw: string): ParsedTarget {
  let rest = raw.trim()
  const blockIdx = rest.indexOf('^')
  if (blockIdx !== -1) rest = rest.slice(0, blockIdx)
  const headIdx = rest.indexOf('#')
  if (headIdx !== -1) rest = rest.slice(0, headIdx)
  return { page: stripMd(rest.trim()) }
}

/**
 * Resolve a raw link page (no extension) to a concrete workspace path.
 * Returns the matched path (with .md) or null when nothing matches.
 *
 * Rules:
 *  - A page containing "/" is treated as a full path from the workspace root.
 *  - Otherwise we match by basename; exact-case wins over case-insensitive,
 *    and the shortest path wins ties (closest to root).
 *
 * PARITY NOTE: VaultIndex.resolve implements the same rules plus frontmatter
 * aliases. Alias-blindness is deliberately correct for this function's one
 * indirect caller, rewriteLinks: an alias link (`[[Mara]]`) keeps resolving to
 * the renamed note (its aliases travel with it), so it must NOT be rewritten.
 * If you change resolution rules here, mirror them in VaultIndex.resolve.
 */
export function resolvePage(page: string, allPaths: string[]): string | null {
  if (page === '') return null

  if (page.includes('/')) {
    const want = stripMd(page).toLowerCase()
    const hit = allPaths.find((p) => stripMd(p).toLowerCase() === want)
    return hit ?? null
  }

  const wantLower = page.toLowerCase()
  let exact: string | null = null
  let ci: string | null = null
  for (const p of allPaths) {
    const base = basename(p)
    if (base === page) {
      if (!exact || p.length < exact.length) exact = p
    } else if (base.toLowerCase() === wantLower) {
      if (!ci || p.length < ci.length) ci = p
    }
  }
  return exact ?? ci
}

/** Given a raw link target, return the resolved path or null. */
export function resolveTarget(raw: string, allPaths: string[]): string | null {
  return resolvePage(parseTarget(raw).page, allPaths)
}

/**
 * A resolver over ONE snapshot of the vault's paths, with the lookups prebuilt.
 *
 * `resolvePage` scans `allPaths` on every call, which is the right shape for the
 * UI's one-off "is this link resolved?" checks. A rename is the opposite shape —
 * thousands of links resolved against one unchanging path set — and there the
 * linear scan was the entire cost of the operation (2.4s to move one note in a
 * 4k-note vault). Build this once and hand it to `rewriteLinks` instead.
 *
 * PARITY: this must resolve exactly as `resolvePage` does — same precedence,
 * same tie-breaks, same alias-blindness. `links.test.ts` asserts the two agree.
 */
export interface LinkResolver {
  resolve(page: string): string | null
}

export function makeResolver(allPaths: string[]): LinkResolver {
  const byFull = new Map<string, string>() // full path (no ext), lowercased -> path
  const byBase = new Map<string, string[]>() // basename lowercased -> paths
  for (const p of allPaths) {
    const full = stripMd(p).toLowerCase()
    // FIRST wins, matching resolvePage's `allPaths.find(...)`.
    if (!byFull.has(full)) byFull.set(full, p)
    const b = basename(p).toLowerCase()
    const arr = byBase.get(b)
    if (arr) arr.push(p)
    else byBase.set(b, [p])
  }
  // Shortest (closest to root) first, so the scans below can stop at their first
  // hit. Sort is stable, so equal-length paths keep `allPaths` order — which is
  // how resolvePage breaks that tie too (its comparison is a strict `<`).
  for (const arr of byBase.values()) arr.sort((a, b) => a.length - b.length)

  return {
    resolve(page) {
      if (page === '') return null
      if (page.includes('/')) return byFull.get(stripMd(page).toLowerCase()) ?? null
      const cands = byBase.get(page.toLowerCase())
      if (!cands) return null
      for (const p of cands) if (basename(p) === page) return p // exact case wins
      return cands[0]
    }
  }
}

/** Suggest a path for a new note created from an unresolved link. */
export function pathForNewNote(raw: string): string {
  const { page } = parseTarget(raw)
  return page.endsWith('.md') ? page : `${page}.md`
}

/**
 * Rewrite every wikilink in `text` that resolves to `oldPath` so it points at
 * `newPath`, preserving each link's style (bare basename vs full path), its
 * heading/block suffix, and its alias. `allPaths` is the file set *before* the
 * rename, used to resolve the original links. Links inside code (fenced blocks
 * and inline spans) are left untouched — they aren't real links.
 */
export function rewriteLinks(
  text: string,
  oldPath: string,
  newPath: string,
  allPaths: string[] | LinkResolver
): string {
  // A note with no wikilink cannot need rewriting, and a rename asks this of
  // every note in the vault — so answer it before paying for `codeRanges` and
  // the match loop. Roughly half a real vault's notes take this exit.
  if (!text.includes('[[')) return text
  const resolver = Array.isArray(allPaths) ? makeResolver(allPaths) : allPaths
  const skip = codeRanges(text)
  return text.replace(/\[\[([^\]\n]+?)\]\]/g, (whole, inner: string, offset: number) => {
    if (inRanges(offset, skip)) return whole
    const pipe = inner.indexOf('|')
    const linkpart = pipe === -1 ? inner : inner.slice(0, pipe)
    const aliaspart = pipe === -1 ? '' : inner.slice(pipe) // includes leading '|'
    const sep = linkpart.search(/[#^]/)
    const page = (sep === -1 ? linkpart : linkpart.slice(0, sep)).trim()
    const suffix = sep === -1 ? '' : linkpart.slice(sep)
    if (resolver.resolve(stripMd(page)) !== oldPath) return whole
    const newPage = page.includes('/') ? stripMd(newPath) : basename(newPath)
    return `[[${newPage}${suffix}${aliaspart}]]`
  })
}
