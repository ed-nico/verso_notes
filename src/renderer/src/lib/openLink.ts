import { useStore } from '../store'
import { seekPlayer } from './videobus'

/** Handle a click on a standard Markdown link `[text](target)`. */
export function openLinkTarget(target: string): void {
  // Video timestamp: video-seek:<provider>:<id>:<seconds> → seek the embedded player.
  if (target.startsWith('video-seek:')) {
    const rest = target.slice('video-seek:'.length)
    const at = rest.lastIndexOf(':')
    if (at > 0) seekPlayer(rest.slice(0, at), Number(rest.slice(at + 1)) || 0)
    return
  }
  // PDF highlight ref: hl:<pdfPath>#<id>
  if (target.startsWith('hl:')) {
    const rest = target.slice(3)
    const hash = rest.lastIndexOf('#')
    if (hash > 0) useStore.getState().openPdf(rest.slice(0, hash), rest.slice(hash + 1))
    return
  }
  // PDF file
  if (/\.pdf($|[?#])/i.test(target)) {
    useStore.getState().openPdf(target.replace(/[?#].*$/, ''))
    return
  }
  // External link → OS browser (main denies in-app windows and opens externally)
  if (/^https?:/i.test(target)) {
    window.open(target, '_blank')
    return
  }
  // Otherwise treat as a note path
  useStore.getState().navigate(target)
}
