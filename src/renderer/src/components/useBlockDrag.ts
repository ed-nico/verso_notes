import { useEffect, useRef, useState } from 'react'
import { childrenRange, cloneBlocks, indexOfBlock, isList, type Block } from '../lib/blocks'

/** Where the drop indicator should be drawn (viewport coordinates). */
export interface DropHint {
  top: number
  left: number
  width: number
}

interface DragState {
  id: number
  startX: number
  startY: number
  origLevel: number
  /** False until the pointer has moved far enough to count as a drag (vs. a click). */
  active: boolean
}

export interface BlockDrag {
  /** Start a potential drag from a bullet/number handle. */
  onHandleMouseDown: (b: Block, e: React.MouseEvent) => void
  /** Where to draw the drop line, or null when there's no valid target. */
  dropHint: DropHint | null
  /** True for ~250ms after a drag ends, so the trailing click doesn't also zoom. */
  justDragged: () => boolean
}

/** Pixels of rightward travel needed to gain one nesting level. Deliberately larger
 *  than SHED_PX (Workflowy-style resistance): nesting deeper should feel intentional,
 *  un-nesting should feel easy. */
const GAIN_PX = 24 / 0.4
const SHED_PX = 24
/** One indent level, in px — matches the row's `paddingLeft: depth * 24`. */
const INDENT_PX = 24

/**
 * Drag-reorder for outliner rows: drag a bullet/number handle to move a block and
 * its whole subtree, with horizontal travel choosing the new nesting depth.
 *
 * Every handler reads REFS rather than render closures, which is why the document
 * listeners can be subscribed exactly once instead of re-bound on every keystroke.
 * Keep it that way — capturing `blocks` here would resubscribe three listeners per
 * character typed.
 */
export function useBlockDrag(opts: {
  /** Always-current blocks. */
  blocksRef: React.RefObject<Block[]>
  /** Always-current zoom root id (null when not zoomed). */
  zoomIdRef: React.RefObject<number | null>
  /** The outliner element, for finding rendered rows. */
  outlinerRef: React.RefObject<HTMLDivElement | null>
  /** Latest commit closure, so the drop lands as a proper undo step. */
  commitRef: React.RefObject<(next: Block[], coalesceKey?: string) => void>
}): BlockDrag {
  const { blocksRef, zoomIdRef, outlinerRef, commitRef } = opts
  const dragRef = useRef<DragState | null>(null)
  const dropRef = useRef<{ beforeId: number | null; depth: number } | null>(null)
  const justDraggedRef = useRef(false)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)

  const onHandleMouseDown = (b: Block, e: React.MouseEvent): void => {
    if (!isList(b) || e.button !== 0) return
    e.preventDefault() // no text selection during the drag; click (zoom/toggle) still fires
    dragRef.current = { id: b.id, startX: e.clientX, startY: e.clientY, origLevel: b.level, active: false }
  }

  // The dragged subtree swaps position via a drop gap between VISIBLE rows; the drop
  // depth is clamped to [below.level, above.level + 1] — never deeper than one past
  // the row above.
  useEffect(() => {
    const clear = (): void => {
      dragRef.current = null
      dropRef.current = null
      setDropHint(null)
    }
    /** No valid drop target under the pointer right now. */
    const noTarget = (): void => {
      dropRef.current = null
      setDropHint(null)
    }

    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 5) return
        d.active = true
      }
      const src = blocksRef.current
      const sIdx = indexOfBlock(src, d.id)
      if (sIdx < 0) return clear()
      const [, sEnd] = childrenRange(src, sIdx)
      const rowEls = [...(outlinerRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])]
      if (!rowEls.length) return
      const idOf = (el: HTMLElement): number => Number(el.dataset.blockId)
      const rawOf = (el: HTMLElement): number => indexOfBlock(src, idOf(el))

      // The gap: insert before the first visible row whose midpoint is below the pointer.
      let gapDom = rowEls.length
      for (let i = 0; i < rowEls.length; i++) {
        const r = rowEls[i].getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          gapDom = i
          break
        }
      }
      const beforeEl = gapDom < rowEls.length ? rowEls[gapDom] : null
      const beforeRaw = beforeEl ? rawOf(beforeEl) : src.length
      // Gaps inside the dragged subtree aren't targets.
      if (beforeRaw > sIdx && beforeRaw < sEnd) return noTarget()
      // When zoomed, nothing may drop above the zoom root (that leaves the view).
      const zi = zoomIdRef.current != null ? indexOfBlock(src, zoomIdRef.current) : -1
      if (zi >= 0 && beforeRaw <= zi) return noTarget()

      // The row above the gap; if that's the dragged subtree itself, use the row above it.
      let ai = gapDom - 1
      while (ai >= 0) {
        const r = rawOf(rowEls[ai])
        if (r >= sIdx && r < sEnd) ai--
        else break
      }
      const aboveEl = ai >= 0 ? rowEls[ai] : null
      const above = aboveEl ? src[rawOf(aboveEl)] : undefined
      // The block below the gap once the subtree is lifted out (gap right above the
      // dragged row → the block after its subtree; gap at the very end → none).
      const below = beforeEl ? (beforeRaw === sIdx ? src[sEnd] : src[beforeRaw]) : undefined
      const zFloor = zi >= 0 && isList(src[zi]) ? src[zi].level + 1 : 0
      const maxD = above ? (isList(above) ? above.level + 1 : 0) : 0
      const minD = Math.max(below && isList(below) ? below.level : 0, zFloor)
      if (minD > maxD) return noTarget()

      const dx = e.clientX - d.startX
      const desired = d.origLevel + (dx >= 0 ? Math.floor(dx / GAIN_PX) : -Math.floor(-dx / SHED_PX))
      const depth = Math.min(maxD, Math.max(minD, desired))
      dropRef.current = { beforeId: beforeEl ? idOf(beforeEl) : null, depth }

      // Indicator geometry: the gap line, indented to the target depth. Rows may render
      // rebased (zoom), so derive the visual offset from the anchor row's own padding.
      const anchorEl = beforeEl ?? aboveEl ?? rowEls[0]
      const anchorBlock = src[rawOf(anchorEl)]
      const ar = anchorEl.getBoundingClientRect()
      const pad = parseFloat(anchorEl.style.paddingLeft || '0')
      const rebase = (isList(anchorBlock) ? anchorBlock.level : 0) - pad / INDENT_PX
      const left = ar.left - pad + Math.max(0, depth - rebase) * INDENT_PX + 38
      const top = beforeEl ? ar.top : aboveEl ? aboveEl.getBoundingClientRect().bottom : ar.bottom
      setDropHint({ top: top - 1, left, width: Math.max(60, ar.right - left) })
    }

    const finish = (apply: boolean): void => {
      const d = dragRef.current
      const t = dropRef.current
      if (d?.active) {
        justDraggedRef.current = true // swallow the click-to-zoom this drag would fire
        window.setTimeout(() => (justDraggedRef.current = false), 250)
      }
      if (apply && d?.active && t) {
        const src = blocksRef.current
        const sIdx = indexOfBlock(src, d.id)
        if (sIdx >= 0) {
          const [, sEnd] = childrenRange(src, sIdx)
          let at = t.beforeId != null ? indexOfBlock(src, t.beforeId) : src.length
          const delta = t.depth - src[sIdx].level
          const inSelf = at > sIdx && at < sEnd
          const noop = delta === 0 && (at === sIdx || at === sEnd)
          if (at >= 0 && !inSelf && !noop) {
            const next = cloneBlocks(src)
            const group = next
              .splice(sIdx, sEnd - sIdx)
              .map((b) => (isList(b) ? { ...b, level: b.level + delta } : b))
            if (at > sIdx) at -= group.length
            next.splice(at, 0, ...group)
            // A collapsed new parent would swallow the drop invisibly — expand it.
            for (let k = at - 1; k >= 0 && t.depth > 0; k--) {
              const pb = next[k]
              if (!isList(pb)) break
              if (pb.level < t.depth) {
                if (pb.collapsed) next[k] = { ...pb, collapsed: false }
                break
              }
            }
            commitRef.current(next)
          }
        }
      }
      clear()
    }

    const onUp = (): void => finish(true)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dragRef.current?.active) finish(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }
    // Refs only (see the doc comment) — subscribe once for the editor's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { onHandleMouseDown, dropHint, justDragged: () => justDraggedRef.current }
}
