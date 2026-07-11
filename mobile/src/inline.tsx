/**
 * Tiny inline-markdown renderer for the mobile reader: bold, italic, inline
 * code, [[wikilinks]], [md](links), #tags, bare URLs. Images render as a named
 * placeholder chip for now (assets need a file-URL bridge — later).
 */
import React from 'react'

export interface InlineOpts {
  onWikilink: (target: string) => void
  onUrl: (url: string) => void
}

const TOKEN =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|!\[[^\]\n]*\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\)|\[\[[^\]\n]+\]\]|(?:^|(?<=\s))#[\p{L}\d][\p{L}\d_/-]*|https?:\/\/\S+)/gu

export function renderInline(text: string, opts: InlineOpts): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const t = m[0]
    const key = k++
    if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>)
    else if ((t.startsWith('*') || t.startsWith('_')) && t.length > 2)
      out.push(<em key={key}>{t.slice(1, -1)}</em>)
    else if (t.startsWith('![')) {
      const alt = t.slice(2, t.indexOf(']'))
      out.push(
        <span key={key} className="img-chip">
          🖼 {alt.split('|')[0] || 'image'}
        </span>
      )
    } else if (t.startsWith('[[')) {
      const inner = t.slice(2, -2)
      const [target, label] = inner.split('|')
      out.push(
        <a key={key} className="wikilink" onClick={() => opts.onWikilink(target.trim())}>
          {(label ?? target).trim()}
        </a>
      )
    } else if (t.startsWith('[')) {
      const label = t.slice(1, t.indexOf(']'))
      const url = t.slice(t.indexOf('(') + 1, -1)
      out.push(
        <a key={key} className="extlink" onClick={() => opts.onUrl(url)}>
          {label}
        </a>
      )
    } else if (t.startsWith('#')) {
      out.push(
        <span key={key} className="tag">
          {t}
        </span>
      )
    } else {
      out.push(
        <a key={key} className="extlink" onClick={() => opts.onUrl(t)}>
          {t}
        </a>
      )
    }
    last = i + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
