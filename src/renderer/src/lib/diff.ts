/**
 * A line diff, for comparing two near-duplicate notes side by side.
 *
 * Deliberately a LINE diff and not a word one: the question being answered is
 * "which of these two do I keep, and does the other hold anything the first one
 * doesn't?" — and that is read a line at a time. A word-level diff would be more
 * precise and much harder to skim.
 */

export type DiffKind = 'same' | 'add' | 'del' | 'change'

export interface DiffRow {
  kind: DiffKind
  /** Left-hand line (absent on a pure addition). */
  a?: string
  /** Right-hand line (absent on a pure deletion). */
  b?: string
}

/** Above this many lines the O(n·m) table stops being worth building; the caller
 *  is told rather than left waiting on a note nobody diffs by hand anyway. */
export const DIFF_MAX_LINES = 1500

export interface DiffResult {
  rows: DiffRow[]
  /** Lines identical in both / total rows — 1 means the notes are the same. */
  sameRatio: number
  /** True when the inputs were too large to diff (rows is then empty). */
  tooLarge: boolean
}

/**
 * Longest-common-subsequence diff over lines.
 *
 * The table is Uint32 rather than nested arrays: at the size cap that is one
 * 9 MB allocation instead of ~1,500 small ones, and the whole point of the cap
 * is to keep this predictable.
 */
export function diffLines(aText: string, bText: string): DiffResult {
  const a = aText.split('\n')
  const b = bText.split('\n')
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return { rows: [], sameRatio: 0, tooLarge: true }
  }
  const n = a.length
  const m = b.length
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let same = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', a: a[i], b: b[j] })
      same++
      i++
      j++
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      rows.push({ kind: 'del', a: a[i++] })
    } else {
      rows.push({ kind: 'add', b: b[j++] })
    }
  }
  while (i < n) rows.push({ kind: 'del', a: a[i++] })
  while (j < m) rows.push({ kind: 'add', b: b[j++] })

  // Pair a deletion immediately followed by an addition into one "changed" row,
  // so an edited line reads as one line edited rather than two unrelated ones.
  const merged: DiffRow[] = []
  for (let k = 0; k < rows.length; k++) {
    const cur = rows[k]
    const next = rows[k + 1]
    if (cur.kind === 'del' && next?.kind === 'add') {
      merged.push({ kind: 'change', a: cur.a, b: next.b })
      k++
    } else {
      merged.push(cur)
    }
  }
  return { rows: merged, sameRatio: merged.length ? same / merged.length : 1, tooLarge: false }
}
