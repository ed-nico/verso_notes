/** Tiny event bus so a wikilink/highlight click can scroll the open PDF viewer. */
type Handler = (highlightId: string) => void

let handler: Handler | null = null
let queued: string | null = null

export const pdfBus = {
  /** Scroll the active PDF viewer to a highlight (queues if the viewer isn't ready yet). */
  goto(id: string): void {
    if (handler) handler(id)
    else queued = id
  },
  /** PdfView subscribes on mount; drains any queued goto. */
  subscribe(fn: Handler): () => void {
    handler = fn
    if (queued) {
      const id = queued
      queued = null
      setTimeout(() => fn(id), 50)
    }
    return () => {
      if (handler === fn) handler = null
    }
  }
}
