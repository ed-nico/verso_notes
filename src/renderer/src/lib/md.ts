/**
 * Small shared markdown-scanning helpers used by both the note parser and the
 * link rewriter, so "what counts as code" stays consistent across features.
 */

/**
 * The [start, end) character ranges of code in `text`: fenced blocks (``` or
 * ~~~, line-based, unclosed fences run to EOF) plus inline `code` spans that
 * fall outside any fence. Positions inside these ranges must not be indexed
 * for links/tags nor rewritten on rename.
 */
export function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []

  // Fenced blocks: a fence opens with ``` or ~~~ at (possibly indented) line
  // start and closes with a fence using the same marker character.
  const lines = text.split('\n')
  let pos = 0
  let fenceStart = -1
  let fenceChar = ''
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (m) {
      if (fenceStart === -1) {
        fenceStart = pos
        fenceChar = m[1][0]
      } else if (m[1][0] === fenceChar) {
        ranges.push([fenceStart, pos + line.length])
        fenceStart = -1
      }
    }
    pos += line.length + 1
  }
  if (fenceStart !== -1) ranges.push([fenceStart, text.length]) // unclosed fence

  // Inline `code` outside the fences.
  const inline = /`[^`\n]+`/g
  let m: RegExpExecArray | null
  while ((m = inline.exec(text))) {
    if (!inRanges(m.index, ranges)) ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

/** True when `pos` falls inside one of the [start, end) `ranges`. */
export function inRanges(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e)
}

/**
 * The ranges of `{{query …}}` / `{{base …}}` blocks.
 *
 * These are SEARCH EXPRESSIONS, not content: the `#film` inside
 * `{{query #film}}` describes what to find, so counting it as one of the note's
 * own tags makes every query match the note that contains it. Same for a
 * `[[Page]]` criterion, which would otherwise manufacture a backlink.
 */
export function embedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /\{\{\s*(?:query|base)\b[^}]*\}\}/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length])
  return out
}

/**
 * Escape a literal string for embedding in a RegExp. Note names, search queries
 * and spellcheck words are all user data that routinely contains `.`, `(`, `+`
 * and friends — every place that builds a regex from them needs this.
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
