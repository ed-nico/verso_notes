/**
 * Where the editor should place the caret after the next render.
 *
 * The block outliner mounts a fresh <textarea> whenever the edited block changes,
 * so caret placement can't happen at the call site — the element doesn't exist
 * yet. Callers stash a request here and an effect applies it once the textarea is
 * mounted (clamping to the field's length and focusing it).
 */
export type CaretPos = 'start' | 'end' | number

export interface PendingCaret {
  id: number
  pos: CaretPos
  /** Set to select a range rather than collapse the caret. */
  end?: CaretPos
}
