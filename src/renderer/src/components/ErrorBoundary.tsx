import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Keeps one crashing view from taking down the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props): void {
    // Reset when the children change (e.g. switching tabs/views).
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="scroll-area">
          <div className="doc">
            <h3 style={{ color: 'var(--danger)' }}>This view hit an error</h3>
            <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', fontSize: 13 }}>
              {this.state.error.message}
            </pre>
            <button className="btn ghost" onClick={() => this.setState({ error: null })}>
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
