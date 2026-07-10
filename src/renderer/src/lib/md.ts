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
