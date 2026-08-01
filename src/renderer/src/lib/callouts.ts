/**
 * Obsidian-style callouts — a blockquote whose first line is `> [!kind] Title`.
 *
 * Nothing about a callout is stored on the Block: it is derived from the quote's
 * text on every render, so a callout round-trips to disk as the plain Markdown
 * blockquote it already is. Add a kind to CALLOUTS and it works everywhere a
 * quote renders (editor, previews, compile) with no other change.
 */

export interface CalloutKind {
  /** Canonical key — also the `data-callout` value the CSS keys off. */
  key: string
  label: string
  icon: string
  /** Other spellings Obsidian accepts for this kind. */
  aliases?: string[]
}

export const CALLOUTS: CalloutKind[] = [
  { key: 'note', label: 'Note', icon: '✎' },
  { key: 'abstract', label: 'Abstract', icon: '≡', aliases: ['summary', 'tldr'] },
  { key: 'info', label: 'Info', icon: 'ℹ' },
  { key: 'tip', label: 'Tip', icon: '✦', aliases: ['hint', 'important'] },
  { key: 'success', label: 'Success', icon: '✓', aliases: ['check', 'done'] },
  { key: 'question', label: 'Question', icon: '?', aliases: ['help', 'faq'] },
  { key: 'warning', label: 'Warning', icon: '⚠', aliases: ['caution', 'attention'] },
  { key: 'failure', label: 'Failure', icon: '✕', aliases: ['fail', 'missing'] },
  { key: 'danger', label: 'Danger', icon: '⚡', aliases: ['error'] },
  { key: 'bug', label: 'Bug', icon: '☣' },
  { key: 'example', label: 'Example', icon: '❑' },
  { key: 'quote', label: 'Quote', icon: '❝', aliases: ['cite'] }
]

/** alias → canonical key, built once. */
const BY_ALIAS = new Map<string, CalloutKind>()
for (const c of CALLOUTS) {
  BY_ALIAS.set(c.key, c)
  for (const a of c.aliases ?? []) BY_ALIAS.set(a, c)
}

export interface Callout {
  kind: CalloutKind
  /** The title as written, or the kind's label when the line gives none. */
  title: string
  /** Everything after the first line (may be empty). */
  body: string
  /** `[!note]+` / `[!note]-` make it collapsible; `-` starts collapsed. */
  foldable: boolean
  startFolded: boolean
}

// `[!kind]` optionally followed by + / - (fold marker) and a title.
const HEAD_RE = /^\[!([A-Za-z][A-Za-z-]*)\]([+-]?)\s*(.*)$/

/**
 * Parse a quote block's text as a callout, or null when its first line isn't a
 * `[!kind]` header — in which case the caller renders an ordinary blockquote.
 * An unknown kind still makes a callout (falling back to `note`), matching
 * Obsidian: a typo shouldn't silently turn the box back into a quote.
 */
export function parseCallout(text: string): Callout | null {
  const nl = text.indexOf('\n')
  const first = nl === -1 ? text : text.slice(0, nl)
  const m = first.match(HEAD_RE)
  if (!m) return null
  const kind = BY_ALIAS.get(m[1].toLowerCase()) ?? CALLOUTS[0]
  return {
    kind,
    title: m[3].trim() || kind.label,
    body: nl === -1 ? '' : text.slice(nl + 1),
    foldable: m[2] !== '',
    startFolded: m[2] === '-'
  }
}
