import { useEffect, useState } from 'react'
import { renderMath } from '../lib/math'

/**
 * Rendered LaTeX — `MathSpan` for inline `$…$`, `MathBlock` for display `$$…$$`.
 *
 * KaTeX is lazy-loaded, so until it lands the raw source shows in monospace
 * rather than a blank gap: unrendered math still reads as math, and a note full
 * of formulas doesn't flash empty on open. KaTeX never throws here (see
 * lib/math.ts), so there's no error branch — bad TeX renders itself in red.
 */
function useMathHtml(tex: string, display: boolean): string | null {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void renderMath(tex, display).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [tex, display])
  return html
}

export function MathSpan({ tex }: { tex: string }): React.JSX.Element {
  const html = useMathHtml(tex, false)
  if (html === null) return <code className="bl-math-raw">{tex}</code>
  // KaTeX escapes its input and emits markup it built itself, not user HTML.
  return <span className="bl-math" dangerouslySetInnerHTML={{ __html: html }} />
}

export function MathBlock({ tex }: { tex: string }): React.JSX.Element {
  const html = useMathHtml(tex, true)
  if (html === null) return <pre className="bl-math-raw block">{tex}</pre>
  return <div className="bl-math display" dangerouslySetInnerHTML={{ __html: html }} />
}
