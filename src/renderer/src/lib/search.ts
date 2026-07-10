/**
 * Lightweight vault search: fuzzy filename matching plus full-text body matching
 * with a snippet. Shared by the sidebar search box and the command palette.
 */
import type { NoteFile, ParsedNote } from '@shared/types'
import { stripFrontmatter, stripFrontmatterFast } from './frontmatter'

interface SearchHit {
  path: string
  name: string
  score: number
  /** A short body excerpt around the first content match, or '' for name-only hits. */
  snippet: string
  /** True when the query matched inside the note body (not just the filename). */
  inBody: boolean
}

/**
 * Subsequence fuzzy score: -1 if `query` isn't a subsequence of `target`, else a
 * positive score that rewards consecutive characters and word-boundary starts.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q === '') return 0
  let qi = 0
  let score = 0
  let prev = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let s = 1
      if (ti === prev + 1) s += 4 // consecutive run
      if (ti === 0 || /[\s/_\-.]/.test(t[ti - 1])) s += 6 // word boundary
      score += s
      prev = ti
      qi++
    }
  }
  if (qi < q.length) return -1
  // Prefer shorter targets (less noise) on ties.
  return score + Math.max(0, 10 - t.length / 4)
}

/** Build a ~120-char snippet centred on `at`, with surrounding whitespace collapsed. */
function snippetAround(body: string, at: number, len: number): string {
  const radius = 50
  const start = Math.max(0, at - radius)
  const end = Math.min(body.length, at + len + radius)
  let s = body.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '… ' + s
  if (end < body.length) s = s + ' …'
  return s
}

/**
 * Search the vault. A query is split into space-separated terms; a note matches when
 * EVERY term appears in its name, one of its aliases, or its body (order-independent).
 * The quick-switcher also keeps a fuzzy (subsequence) name match for the whole query so
 * "chipwar" still finds "Chip War". Filename/alias matches rank above body-only ones.
 * Returns up to `limit` hits sorted by score descending.
 *
 * Pass `opts.parsed` (the store's path → ParsedNote map) to avoid re-parsing
 * YAML frontmatter per note per keystroke: aliases come from the parsed note
 * and the body is sliced with a cheap fence scan instead of a YAML load.
 */
export function searchNotes(
  query: string,
  files: NoteFile[],
  texts: Record<string, string>,
  limit = 50,
  opts: {
    fuzzyNames?: boolean
    aliasOf?: (path: string) => string[]
    parsed?: Record<string, ParsedNote>
  } = {}
): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const ql = q.toLowerCase()
  const terms = ql.split(/\s+/).filter(Boolean)
  const fuzzyNames = opts.fuzzyNames ?? true
  const needBody = terms.some((t) => t.length >= 2)
  const hits: SearchHit[] = []

  for (const f of files) {
    const p = opts.parsed?.[f.path]
    const aliases = opts.aliasOf?.(f.path) ?? p?.aliases ?? []
    const names = [f.name, ...aliases]
    const nameHay = names.join('\n').toLowerCase()
    // With parsed data available there's nothing left to learn from the YAML —
    // slice the body off with a plain fence scan. Fall back to the full parse.
    const body = needBody
      ? p
        ? stripFrontmatterFast(texts[f.path] ?? '')
        : stripFrontmatter(texts[f.path] ?? '')
      : ''
    const bodyLower = body.toLowerCase()

    // (1) Quick-switcher fuzzy path: the whole query as a subsequence of a name/alias.
    // Fuzzy is great for the switcher but far too loose for a search box (`fuzzyNames`
    // is off there — "news" subsequence-matches "Notion Review … Success").
    let fuzzyBest = -1
    if (fuzzyNames) for (const n of names) fuzzyBest = Math.max(fuzzyBest, fuzzyScore(q, n))
    const fuzzyOk = fuzzyBest >= 0

    // (2) Multi-term AND path: every term must hit the name/alias or the body.
    let termsOk = true
    let nameTermScore = 0
    let bodyTermScore = 0
    let firstBodyIdx = -1
    for (const t of terms) {
      const at = nameHay.indexOf(t)
      const bodyAt = bodyLower.indexOf(t)
      if (at < 0 && bodyAt < 0) {
        termsOk = false
        break
      }
      if (at >= 0) nameTermScore += 24 - Math.min(20, at)
      else {
        bodyTermScore += 8
        if (firstBodyIdx < 0) firstBodyIdx = bodyAt
      }
    }

    if (!fuzzyOk && !termsOk) continue

    let inBody = false
    let snippet = ''
    if (firstBodyIdx >= 0) {
      inBody = true
      snippet = snippetAround(body, firstBodyIdx, terms[0].length)
    }

    const score = (fuzzyOk ? fuzzyBest + 20 : 0) + (termsOk ? nameTermScore + bodyTermScore : 0)
    hits.push({ path: f.path, name: f.name, score, snippet, inBody })
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return hits.slice(0, limit)
}
