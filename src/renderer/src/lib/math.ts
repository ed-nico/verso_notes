/**
 * LaTeX rendering, kept behind ONE function (`renderMath`) so the engine can be
 * swapped without touching a component — same shape as lib/mermaid.ts.
 *
 * KaTeX plus its stylesheet is ~500 kB, so it's imported lazily on first use: a
 * vault with no math never pays for it. The stylesheet is imported from inside
 * the lazy module deliberately — that puts it in the same chunk, so the CSS and
 * its web fonts arrive with the engine instead of at app start.
 *
 * KaTeX is a direct dependency even though mermaid also pulls it in: a mermaid
 * minor could drop or bump it, and math would break for reasons nothing in this
 * file explains.
 */

/**
 * The inline `$…$` delimiter rule, as a regex SOURCE fragment so it can be
 * spliced into InlineMarkdown's big alternation and still be unit-tested here.
 * One capture group: the TeX, without the delimiters.
 *
 * The guards are what keep prose safe. No whitespace just inside either `$`
 * (so "$5 and $" can't close), the body excludes `$` outright (so a match can
 * never span two currency amounts), and no digit after the closer (so
 * "$100-$200" stays money). Backslash escapes are allowed through as `\\.`.
 */
export const MATH_INLINE_SRC = String.raw`\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<!\s)\$(?!\d)`

type Katex = (typeof import('katex'))['default']

let loading: Promise<Katex> | null = null

function load(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default)
  return loading
}

/**
 * Render TeX to an HTML string.
 *
 * Never throws: KaTeX's `throwOnError: false` renders the offending source in
 * its own error colour, which is what you want mid-keystroke — half-typed math
 * should look unfinished, not blow up the note. `trust: false` (the default)
 * disables \href and \includegraphics, so note content can't inject a URL.
 */
export async function renderMath(tex: string, displayMode: boolean): Promise<string> {
  const katex = await load()
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    errorColor: 'var(--danger)',
    output: 'html',
    strict: false
  })
}
