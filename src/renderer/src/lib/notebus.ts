/**
 * Lets the PDF pane insert a block into the currently-open note editor live
 * (the editor owns its block state, so we push through it rather than the store).
 */
type Handler = (markdown: string) => void

const handlers = new Map<string, Handler>()

export const noteBus = {
  subscribe(path: string, fn: Handler): () => void {
    handlers.set(path, fn)
    return () => {
      if (handlers.get(path) === fn) handlers.delete(path)
    }
  },
  /** Returns true if a live editor for `path` handled the insert. */
  insert(path: string, markdown: string): boolean {
    const h = handlers.get(path)
    if (h) {
      h(markdown)
      return true
    }
    return false
  }
}
