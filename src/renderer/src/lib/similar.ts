/**
 * "Similar notes" — TF-IDF cosine similarity over note bodies. Fully local and
 * dependency-free (no embedding model, no downloads): it surfaces notes that
 * share DISTINCTIVE vocabulary with the current one, which is what "related"
 * usually means inside one person's vault. Per-note term vectors are cached by
 * text identity (same pattern as query.ts's scanCache), so a rebuild after an
 * edit re-tokenizes only the note that changed.
 */
import { stripFrontmatterFast } from './frontmatter'

/** Words too common to signal anything — kept small; IDF handles the long tail. */
const STOP = new Set(
  (
    'the a an and or but of to in on for with is are was were be been being it its ' +
    'this that these those as at by from not no yes you your i we they he she his her ' +
    'their our my me us them have has had do does did done will would can could should ' +
    'shall may might must if then than so just about into over under more most some any ' +
    'all also there here when what which who whom how why out up down very only even ' +
    'like get got make made one two new now day today time note notes'
  ).split(' ')
)

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\d][\p{L}\d'-]{2,}/gu) ?? []
  return words.filter((w) => !STOP.has(w))
}

interface DocVec {
  text: string
  /** term -> raw count */
  tf: Map<string, number>
}

const docCache = new Map<string, DocVec>()

/** Empty the cache — call when switching vaults so notes can't leak across. */
export function clearSimilarCache(): void {
  docCache.clear()
}

function docOf(path: string, text: string): DocVec {
  const hit = docCache.get(path)
  if (hit && hit.text === text) return hit
  const tf = new Map<string, number>()
  for (const w of tokenize(stripFrontmatterFast(text))) tf.set(w, (tf.get(w) ?? 0) + 1)
  const doc = { text, tf }
  docCache.set(path, doc)
  return doc
}

export interface SimilarHit {
  path: string
  /** Cosine similarity in (0, 1]. */
  score: number
}

/** Notes below this share too little to be worth showing. */
const MIN_SCORE = 0.08

/**
 * The `limit` most similar notes to `path`, best first. Empty when the note is
 * too short to characterize or nothing clears the floor — callers should render
 * NOTHING in that case rather than a weak guess.
 */
export function similarNotes(
  path: string,
  texts: Record<string, string>,
  limit = 5
): SimilarHit[] {
  const meText = texts[path]
  if (meText === undefined) return []
  const me = docOf(path, meText)
  if (me.tf.size < 5) return [] // too short to characterize

  // Document frequencies over the candidate set (Templates are boilerplate, skip).
  const docs: { path: string; tf: Map<string, number> }[] = []
  for (const [p, t] of Object.entries(texts)) {
    if (p.startsWith('Templates/')) continue
    docs.push({ path: p, tf: docOf(p, t).tf })
  }
  const N = docs.length
  if (N < 3) return []
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const term of d.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1)
  }
  const idf = (term: string): number => Math.log(1 + N / (df.get(term) ?? N))

  // My weighted vector (sublinear tf) and norm.
  const mine = new Map<string, number>()
  for (const [term, c] of me.tf) mine.set(term, (1 + Math.log(c)) * idf(term))
  let myNorm = 0
  for (const v of mine.values()) myNorm += v * v
  myNorm = Math.sqrt(myNorm)
  if (myNorm === 0) return []

  const hits: SimilarHit[] = []
  for (const d of docs) {
    if (d.path === path || d.tf.size === 0) continue
    let dot = 0
    let norm = 0
    for (const [term, c] of d.tf) {
      const w = (1 + Math.log(c)) * idf(term)
      norm += w * w
      const mv = mine.get(term)
      if (mv !== undefined) dot += w * mv
    }
    if (dot === 0) continue
    const score = dot / (myNorm * Math.sqrt(norm))
    if (score >= MIN_SCORE) hits.push({ path: d.path, score })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
