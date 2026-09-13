import { useMemo } from 'react'
import { spellStatus, spellable } from '../lib/spell'
import { codeRanges, inRanges } from '../lib/md'

/**
 * The spelling underlines behind the block you're editing.
 *
 * The rendered (non-editing) row gets its squiggles from `renderInline`, which
 * knows which runs are prose — but the moment you click into a block it becomes a
 * plain `<textarea>` and every mark vanished, which is exactly when you're most
 * likely to be fixing a typo. This is a mirror of the field's text, positioned
 * underneath it with the same metrics, drawn ENTIRELY TRANSPARENT except for the
 * underlines. The textarea's own text stays visible on top.
 *
 * Painting only the decoration (rather than the text, as the code-block layer
 * does) is what makes it forgiving: if the mirror ever drifts by a pixel you get a
 * slightly misplaced underline, not doubled text.
 */

/** Words are matched the way the rendered view matches them, so a word doesn't
 *  gain or lose its underline just because the block gained focus. */
const WORD_TOKEN_RE = /[A-Za-z][A-Za-z']*/g

export interface SpellSpan {
  word: string
  start: number
  end: number
}

/**
 * The misspelled words in `text`, with their offsets.
 *
 * Skips what a dictionary has no business judging: fenced and inline code, URLs,
 * wikilink targets, `#tags`, and frontmatter-ish `key:` prefixes. Prose is what's
 * left. `spellStatus` returns undefined for a word it hasn't checked yet and
 * queues it, so the first pass under-reports and the subscription re-renders.
 */
export function candidateWords(text: string): SpellSpan[] {
  const skip = codeRanges(text)
  const out: SpellSpan[] = []
  // Blank out the spans a checker should never see, keeping offsets identical so
  // every match still points at the real character position.
  const masked = text
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
    .replace(/\[\[[^\]\n]*\]\]/g, (m) => ' '.repeat(m.length))
    .replace(/\]\([^)\n]*\)/g, (m) => ' '.repeat(m.length))
    .replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length))
    .replace(/(^|\s)[#@][\w/-]+/g, (m) => ' '.repeat(m.length))
  WORD_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WORD_TOKEN_RE.exec(masked))) {
    const word = m[0]
    if (!spellable(word)) continue
    if (inRanges(m.index, skip)) continue
    out.push({ word, start: m.index, end: m.index + word.length })
  }
  return out
}

/** The candidates the dictionary has actually rejected. `spellStatus` answers
 *  undefined for a word it hasn't seen and queues it, so the first pass
 *  under-reports and the subscription fills the rest in. */
export function misspellings(text: string): SpellSpan[] {
  return candidateWords(text).filter((s) => spellStatus(s.word) === true)
}

export function SpellLayer({ text, tick }: { text: string; tick: number }): React.JSX.Element {
  // `tick` is the intended trigger, not an unused dep: `spellStatus` answers
  // undefined for a word it hasn't checked yet and queues it, so the first pass
  // under-reports and the subscription bump is what fills the underlines in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spans = useMemo(() => misspellings(text), [text, tick])

  const parts: React.ReactNode[] = []
  let last = 0
  spans.forEach((s, i) => {
    if (s.start > last) parts.push(text.slice(last, s.start))
    parts.push(
      <span key={i} className="spell-hit" data-word={s.word} data-start={s.start}>
        {text.slice(s.start, s.end)}
      </span>
    )
    last = s.end
  })
  // A trailing newline collapses in a block box but not in a textarea — pad it so
  // the mirror's last line sits where the field's does.
  parts.push(text.slice(last) + (text.endsWith('\n') ? ' ' : ''))

  return (
    <div className="spell-layer" aria-hidden="true">
      {parts}
    </div>
  )
}
