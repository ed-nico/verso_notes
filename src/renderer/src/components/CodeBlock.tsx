import { useEffect, useState } from 'react'

/** Lazily highlight `text`; null until highlight.js loads (or on failure). */
function useHighlighted(text: string, lang?: string): string | null {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void import('highlight.js/lib/common').then((mod) => {
      if (cancelled) return
      const hljs = mod.default
      try {
        const res =
          lang && hljs.getLanguage(lang)
            ? hljs.highlight(text, { language: lang, ignoreIllegals: true })
            : hljs.highlightAuto(text)
        setHtml(res.value)
      } catch {
        setHtml(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [text, lang])
  return html
}

/**
 * The colour layer behind the code-editing textarea: same text, same metrics,
 * painted underneath while the textarea's own text is transparent — so you get
 * live syntax highlighting while editing. Purely decorative (aria-hidden).
 */
export function CodeHighlightLayer({ text, lang }: { text: string; lang?: string }): React.JSX.Element {
  const html = useHighlighted(text, lang)
  // A trailing newline collapses in a <pre> but not in a textarea — pad it so the
  // layer's height (and every line's position) matches the field exactly.
  const padded = text.endsWith('\n') ? text + ' ' : text
  return (
    <pre className="code-hl-layer hljs" aria-hidden="true">
      {html !== null ? (
        // hljs escapes the source and only injects <span> tags, so this is safe.
        <code dangerouslySetInnerHTML={{ __html: text.endsWith('\n') ? html + ' ' : html }} />
      ) : (
        <code>{padded || ' '}</code>
      )}
    </pre>
  )
}

/**
 * A syntax-highlighted code block. highlight.js is imported lazily (its common
 * bundle is sizeable) so it never weighs down startup — until then the code
 * shows as plain monospace text, then upgrades to highlighted in place.
 */
export function CodeBlock({ text, lang }: { text: string; lang?: string }): React.JSX.Element {
  const html = useHighlighted(text, lang)

  return (
    <pre className="bl-code hljs" data-lang={lang || undefined}>
      {html !== null ? (
        // hljs escapes the source and only injects <span> tags, so this is safe.
        <code dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{text || ' '}</code>
      )}
    </pre>
  )
}
