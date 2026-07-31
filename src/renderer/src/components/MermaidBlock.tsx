import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { renderMermaid } from '../lib/mermaid'

type State = { svg: string } | { error: string } | null

/**
 * A ```mermaid fence rendered as a diagram. Mermaid is loaded lazily, so the
 * block shows nothing but its own height until the engine arrives, then swaps in
 * the SVG. Re-renders when the theme or accent changes so diagrams track the
 * palette. On a syntax error it falls back to the source plus the parser's
 * message — a broken diagram must never hide the text you typed.
 */
export function MermaidBlock({ text }: { text: string }): React.JSX.Element {
  const theme = useStore((s) => s.theme)
  const accent = useStore((s) => s.accent)
  const [state, setState] = useState<State>(null)

  useEffect(() => {
    let cancelled = false
    if (!text.trim()) {
      setState(null)
      return
    }
    void renderMermaid(text, { dark: theme === 'dark' }).then(
      (svg) => {
        if (!cancelled) setState({ svg })
      },
      (err: unknown) => {
        if (!cancelled) setState({ error: err instanceof Error ? err.message : String(err) })
      }
    )
    return () => {
      cancelled = true
    }
    // `accent` isn't read here — it's a palette input that renderMermaid picks up
    // off the CSS variables, so a change to it must re-run the render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, theme, accent])

  if (state && 'error' in state) {
    return (
      <div className="bl-mermaid">
        <pre className="bl-mermaid-src">
          <code>{text}</code>
        </pre>
        <div className="bl-mermaid-msg">{state.error}</div>
      </div>
    )
  }
  return (
    <div className="bl-mermaid">
      {state ? (
        // mermaid renders with securityLevel 'strict', which sanitizes the SVG.
        <div className="bl-mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : (
        <div className="bl-mermaid-pending">&nbsp;</div>
      )}
    </div>
  )
}
