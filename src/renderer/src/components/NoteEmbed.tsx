import { createContext, useContext } from 'react'
import { useStore } from '../store'
import { resolveTarget } from '../lib/links'
import { renderNote, type InlineOpts } from './NotePreview'

/**
 * `![[Note]]` — a note rendered inside another note.
 *
 * This is note-level transclusion only. Block references were removed from the app
 * on purpose and nothing here brings them back: an embed names a whole note, which
 * is what a hub or map-of-content page is actually made of.
 *
 * The embed is READ-ONLY and derives everything from `texts` on render, exactly as
 * the hover preview does — no copy of the content is stored, so the source note
 * stays the only place it lives.
 */

/** Paths already being rendered further up the tree. `![[A]]` inside A — directly
 *  or through a chain — would otherwise recurse until the stack blew. */
const EmbedChain = createContext<readonly string[]>([])

export function NoteEmbed({ raw, host }: { raw: string; host?: string }): React.JSX.Element {
  const files = useStore((s) => s.files)
  const index = useStore((s) => s.index)
  const parsed = useStore((s) => s.parsed)
  const openNote = useStore((s) => s.openNote)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const openTag = useStore((s) => s.openTag)
  // The text is read through getState rather than subscribed to: `texts` is mutated
  // in place on the typing hot path, so a selector on it never fires. `textsTick`
  // is the subscription that does, and it re-renders this with the current text.
  useStore((s) => s.textsTick)

  // `host` is the note doing the embedding. Without it in the chain, `![[Self]]`
  // inside a note would happily render that note inside itself.
  const outer = useContext(EmbedChain)
  const chain = host && !outer.includes(host) ? [...outer, host] : outer
  const paths = files.map((f) => f.path)
  const path = resolveTarget(raw, paths) ?? index.resolvePath(raw)

  if (!path) {
    return (
      <div className="note-embed missing">
        <span className="note-embed-title">{raw}</span>
        <span className="note-embed-note">No note with this name yet.</span>
      </div>
    )
  }
  if (chain.includes(path)) {
    return (
      <div className="note-embed missing">
        <span className="note-embed-title">{raw}</span>
        <span className="note-embed-note">Already shown further up — an embed can’t contain itself.</span>
      </div>
    )
  }

  const name = parsed[path]?.name ?? path.replace(/\.md$/i, '')
  const text = useStore.getState().texts[path]
  const opts: InlineOpts = {
    isResolved: (r) => (resolveTarget(r, paths) ?? index.resolvePath(r)) !== null,
    onNavigate: (r, side) => {
      const target = resolveTarget(r, paths) ?? index.resolvePath(r)
      if (target) (side ? openInSidePane : openNote)(target)
    },
    onTag: openTag,
    // A hover preview of a link inside an embed of the note you're already looking
    // at is one layer of popup too many.
    noPreview: true
  }

  return (
    <EmbedChain.Provider value={[...chain, path]}>
      <div className="note-embed">
        <button
          className="note-embed-title"
          title="Open this note"
          onClick={(e) => (e.metaKey || e.ctrlKey ? openInSidePane(path) : openNote(path))}
        >
          {name}
        </button>
        <div className="note-embed-body">
          {text === undefined ? (
            <span className="note-embed-note">Loading…</span>
          ) : text.trim() === '' ? (
            <span className="note-embed-note">This note is empty.</span>
          ) : (
            renderNote(text, opts, (r) => <NoteEmbed raw={r} />)
          )}
        </div>
      </div>
    </EmbedChain.Provider>
  )
}
