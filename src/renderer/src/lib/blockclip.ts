/**
 * In-app clipboard for whole blocks. The system clipboard only carries the
 * serialized markdown (for interop); this keeps the structured blocks so a
 * paste can rebuild them as real blocks (preserving anchors) rather than
 * dropping raw text into one block. We only trust it when the system clipboard
 * still holds exactly what we copied (otherwise the user copied something else).
 */
import type { Block } from './blocks'
import { cloneBlocks } from './blocks'

let payload: { blocks: Block[]; text: string } | null = null

export const blockClip = {
  set(blocks: Block[], text: string): void {
    payload = { blocks: cloneBlocks(blocks), text: text.trim() }
  },
  /** The copied blocks, iff the system clipboard still matches what we stored. */
  match(systemText: string): Block[] | null {
    if (!payload || payload.text !== systemText.trim()) return null
    return cloneBlocks(payload.blocks)
  }
}
