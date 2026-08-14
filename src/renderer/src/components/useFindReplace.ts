import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { escapeRegExp } from '../lib/md'
import { childrenRange, type Block } from '../lib/blocks'
import type { FindMatch } from './BlockRow'
import type { PendingCaret } from './caret'

/** All case-insensitive occurrences of `q` across the blocks, in document order. */
export function findMatchesIn(blocks: Block[], q: string): FindMatch[] {
  if (!q) return []
  const out: FindMatch[] = []
  const lq = q.toLowerCase()
  blocks.forEach((b, index) => {
    const lt = b.text.toLowerCase()
    let from = 0
    for (;;) {
      const at = lt.indexOf(lq, from)
      if (at < 0) break
      out.push({ id: b.id, index, start: at, end: at + q.length })
      from = at + q.length
    }
  })
  return out
}

/** The find bar's own state: query, replacement, and which match is active (-1 = none). */
interface FindState {
  q: string
  r: string
  idx: number
}

export interface FindReplace {
  /** Null when the bar is closed. */
  find: FindState | null
  setFind: React.Dispatch<React.SetStateAction<FindState | null>>
  /** Every match in the note, in document order. */
  matches: FindMatch[]
  /** The active match, or null — the row containing it renders it highlighted. */
  activeMatch: FindMatch | null
  /** Inline style pinning the bar to the top of the scroll viewport. */
  barStyle: React.CSSProperties
  inputRef: React.RefObject<HTMLInputElement | null>
  openFind: () => void
  /** `landAtMatch` drops the caret into the active match so you can edit it. */
  closeFind: (landAtMatch?: boolean) => void
  /** Scroll match `i` into view (wrapping), keeping focus in the find box. */
  gotoMatch: (i: number) => void
  /** Step to the next (or previous) match; a no-op when there are none. */
  stepMatch: (back: boolean) => void
  replaceCurrent: () => void
  replaceAll: () => void
  onFindKeyDown: (e: React.KeyboardEvent) => void
}

/**
 * In-note find & replace (⌘F), scoped to one editor's blocks.
 *
 * Deliberately never focuses the matched block: focus stays in the find field so
 * Enter / ⌘G keep cycling instead of dropping you into the note. The active match
 * is shown via a <mark> in the RENDERED row, which is also why `gotoMatch` clears
 * the editing block first.
 */
export function useFindReplace(opts: {
  path: string
  blocks: Block[]
  setBlocks: React.Dispatch<React.SetStateAction<Block[]>>
  setEditingId: (id: number | null) => void
  pendingCaret: React.RefObject<PendingCaret | null>
  outlinerRef: React.RefObject<HTMLDivElement | null>
  /** Structural commit (an undo step) — used by Replace all. */
  commit: (next: Block[], coalesceKey?: string) => void
  /** Single-block text replacement that is its own undo step. */
  replaceText: (id: number, text: string) => void
}): FindReplace {
  const { path, blocks, setBlocks, setEditingId, pendingCaret, outlinerRef, commit, replaceText } = opts

  const [find, setFind] = useState<FindState | null>(null)
  const [barStyle, setBarStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const wantFirstJump = useRef(false)
  /** Set by Replace, consumed once `matches` has recomputed. */
  const wantMatchIdx = useRef<number | null>(null)
  const findRequest = useStore((s) => s.findRequest)

  const matches = useMemo(() => findMatchesIn(blocks, find?.q ?? ''), [blocks, find?.q])
  const activeMatch = find && find.idx >= 0 && find.idx < matches.length ? matches[find.idx] : null
  const findOpen = find !== null

  // Expand any collapsed ancestors so a matched block is actually visible before we jump.
  const revealBlock = (idx: number): void => {
    setBlocks((prev) => {
      // An ancestor is any collapsed block whose foldable section CONTAINS idx —
      // childrenRange handles headings (whose sections span level-0 paragraphs)
      // and list subtrees alike; raw level math conflates the two and misses
      // matches hidden under a collapsed heading.
      let changed = false
      const next = [...prev]
      for (let i = 0; i < idx; i++) {
        if (!next[i].collapsed) continue
        const [s, e] = childrenRange(next, i)
        if (idx >= s && idx < e) {
          next[i] = { ...next[i], collapsed: false }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  const gotoMatch = (i: number): void => {
    if (!matches.length) return
    const n = ((i % matches.length) + matches.length) % matches.length
    const m = matches[n]
    setFind((f) => (f ? { ...f, idx: n } : f))
    setEditingId(null) // render the block (so the highlight shows) and don't steal focus
    revealBlock(m.index)
    requestAnimationFrame(() => {
      outlinerRef.current
        ?.querySelector(`[data-block-id="${m.id}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      inputRef.current?.focus() // keep the keyboard in the find box
    })
  }

  const stepMatch = (back: boolean): void => {
    if (matches.length) gotoMatch((find?.idx ?? -1) + (back ? -1 : 1))
  }

  const openFind = (): void => {
    setFind((f) => f ?? { q: '', r: '', idx: -1 })
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const closeFind = (landAtMatch = false): void => {
    const m = activeMatch
    setFind(null)
    if (landAtMatch && m) {
      setEditingId(m.id)
      pendingCaret.current = { id: m.id, pos: m.start, end: m.end }
    } else {
      outlinerRef.current?.focus()
    }
  }

  // Replace the active match, then advance to the next one; stay in the find box.
  const replaceCurrent = (): void => {
    if (!find) return
    if (find.idx < 0 || find.idx >= matches.length) return gotoMatch(0)
    const m = matches[find.idx]
    const b = blocks.find((x) => x.id === m.id)
    if (!b) return
    // If the replacement still contains the query, the recomputed list keeps an entry at
    // this index for the just-inserted text — step past it so we don't re-land on it.
    const stays = find.r.toLowerCase().includes(find.q.toLowerCase())
    wantMatchIdx.current = find.idx + (stays ? 1 : 0)
    replaceText(m.id, b.text.slice(0, m.start) + find.r + b.text.slice(m.end))
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Replace every occurrence across the note as a single undo step.
  const replaceAll = (): void => {
    if (!find?.q) return
    let count = 0
    const re = new RegExp(escapeRegExp(find.q), 'gi')
    const next = blocks.map((b) => {
      re.lastIndex = 0
      const rep = b.text.replace(re, () => {
        count++
        return find.r
      })
      return rep === b.text ? b : { ...b, text: rep }
    })
    if (count > 0) commit(next)
    setFind((f) => (f ? { ...f, idx: -1 } : f))
  }

  const onFindKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation() // keep ⌘Z/⌘A etc. from reaching the outliner while typing here
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFind(true) // drop the caret at the current match so you can edit it
    } else if (e.key === 'Enter' || (mod && (e.key === 'g' || e.key === 'G'))) {
      e.preventDefault()
      stepMatch(e.shiftKey)
    }
  }

  // Pin the bar to the top of the editor's scroll viewport (position: fixed, measured
  // from the .scroll-area) so it never moves while cycling matches or scrolling.
  useLayoutEffect(() => {
    if (!findOpen) return
    const update = (): void => {
      const sa = outlinerRef.current?.closest('.scroll-area') as HTMLElement | null
      if (!sa) return
      const r = sa.getBoundingClientRect()
      const width = Math.min(560, r.width - 24)
      setBarStyle({
        position: 'fixed',
        top: Math.round(r.top + 10),
        left: Math.round(r.right - 12 - width),
        width
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
    // Only the bar's OPEN/closed state moves it; re-measuring on every keystroke in
    // the find field would be pure churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen])

  // Sidebar search → open the in-note find for the searched term and jump to the first match.
  useEffect(() => {
    if (findRequest && findRequest.path === path) {
      const q = findRequest.query
      setFind({ q, r: '', idx: -1 })
      wantFirstJump.current = findMatchesIn(blocks, q).length > 0
      useStore.getState().clearFindRequest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findRequest, path])

  // Once the requested query's matches are computed, jump to the first one (just once).
  useEffect(() => {
    if (wantFirstJump.current && find && matches.length) {
      wantFirstJump.current = false
      gotoMatch(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, find])

  // After Replace, advance to the requested match once the list has recomputed.
  useEffect(() => {
    if (wantMatchIdx.current === null) return
    const target = wantMatchIdx.current
    wantMatchIdx.current = null
    if (matches.length) gotoMatch(target)
    else setFind((f) => (f ? { ...f, idx: -1 } : f))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  return {
    find,
    setFind,
    matches,
    activeMatch,
    barStyle,
    inputRef,
    openFind,
    closeFind,
    gotoMatch,
    stepMatch,
    replaceCurrent,
    replaceAll,
    onFindKeyDown
  }
}
