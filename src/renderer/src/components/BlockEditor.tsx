import { useRef, useState, useEffect, useLayoutEffect, useMemo, useReducer } from 'react'
import { useStore, templatesFromFiles } from '../store'
import { basename, dirname, resolveTarget, stripMd } from '../lib/links'
import { applyTemplate } from '../lib/templates'
import { fileToBase64 } from '../lib/assets'
import { noteBus } from '../lib/notebus'
import { blockClip } from '../lib/blockclip'
import { parseFrontmatter } from '../lib/frontmatter'
import { subscribeSpell, resetSpell } from '../lib/spell'
import { parseVideoUrl, formatTimestamp, videoKey } from '../lib/video'
import { activePlayerKey, currentTime } from '../lib/videobus'
import { renderInline } from './InlineMarkdown'
import { BlockRow, type AcSuggestion, type FindMatch, type RowApi } from './BlockRow'
import { VideoEmbed } from './VideoEmbed'
import { ContextMenu } from './ContextMenu'
import { EntityCard } from './EntityCard'
import {
  buildSupertagIndex,
  normTag,
  supertagsForNote,
  supertagsFromParsed
} from '../lib/supertags'
import { QueryView } from './QueryView'
import { BaseEmbed } from './BaseView'
import { CodeBlock, CodeHighlightLayer } from './CodeBlock'
import { TableEditor } from './TableEditor'
import {
  type Block,
  childrenRange,
  cloneBlocks,
  detectShortcut,
  foldableAt,
  indexOfBlock,
  isList,
  makeBlock,
  moveUnit,
  parseBlocks,
  parseTable,
  serializeBlocks,
  TABLE_TEMPLATE,
  visibleBlocks
} from '../lib/blocks'

type CaretPos = 'start' | 'end' | number
/**
 * The popup under a block. `link` = `[[` wikilink picker; `slash-menu` = the `/`
 * command menu; `slash-template` = the template list shown after picking "Insert
 * template" from that menu.
 */
interface AcState {
  id: number
  query: string
  index: number
  kind: 'link' | 'slash-menu' | 'slash-template'
}

/** Commands offered by the `/` menu. */
const SLASH_COMMANDS: { cmd: string; label: string; icon: string }[] = [
  { cmd: 'template', label: 'Insert template', icon: '▤' },
  { cmd: 'h1', label: 'Heading 1', icon: 'H1' },
  { cmd: 'h2', label: 'Heading 2', icon: 'H2' },
  { cmd: 'h3', label: 'Heading 3', icon: 'H3' },
  { cmd: 'todo', label: 'To-do', icon: '☐' },
  { cmd: 'bullet', label: 'Bullet list', icon: '•' },
  { cmd: 'numbered', label: 'Numbered list', icon: '1.' },
  { cmd: 'table', label: 'Table', icon: '▦' },
  { cmd: 'query', label: 'Query', icon: '{ }' },
  { cmd: 'base', label: 'Base (embed a saved view)', icon: '▦' }
]

/** Typing one of these while text is selected wraps the selection instead of replacing it. */
const WRAP_PAIRS: Record<string, string> = { '[': ']', '(': ')', '{': '}', '"': '"', "'": "'", '`': '`' }

/** Escape a literal string for use inside a RegExp (for find & replace). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A stable, pleasant background color for a tag's letter avatar (derived from its name). */
function tagAvatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 42%, 46%)`
}

/** All case-insensitive occurrences of `q` across the blocks, in document order. */
function findMatchesIn(blocks: Block[], q: string): FindMatch[] {
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

/**
 * The character offset within `root`'s text at viewport point (x, y), or null if it
 * can't be determined. Used so clicking a rendered block lands the caret where you
 * clicked (clicking past the text returns the end). Offsets are against the rendered
 * text, which matches the raw text for plain prose.
 */
function caretOffsetAt(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const range = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null
  if (!range || !root.contains(range.startContainer)) return null
  let total = 0
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) return total + range.startOffset
    total += (node.textContent ?? '').length
  }
  return null
}

/**
 * Whether the caret in a textarea sits on its first / last *visual* line, accounting for
 * soft word-wrap (not just literal `\n`). A long block that wraps over several display rows
 * should let ArrowUp/Down move between those rows and only jump to the adjacent block from
 * the true top/bottom row. Measured with a hidden mirror div that copies the textarea's
 * layout-affecting styles, so its wrapping matches.
 */
let caretMirror: HTMLDivElement | null = null
function caretLine(ta: HTMLTextAreaElement): { atFirst: boolean; atLast: boolean } {
  const cs = window.getComputedStyle(ta)
  // One persistent hidden mirror, reused across calls — creating/appending/removing a
  // div per ArrowUp/Down forces layout churn on every keypress.
  if (!caretMirror) {
    caretMirror = document.createElement('div')
    caretMirror.style.position = 'absolute'
    caretMirror.style.top = '-9999px'
    caretMirror.style.left = '-9999px'
    caretMirror.style.visibility = 'hidden'
    caretMirror.style.whiteSpace = 'pre-wrap'
    caretMirror.style.overflowWrap = 'break-word'
    document.body.appendChild(caretMirror)
  }
  const div = caretMirror
  const props = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'
  ] as const
  for (const p of props) div.style[p as never] = cs[p as never]
  // The top of the line containing `index` = offsetTop of a span placed at that index.
  const topAt = (index: number): number => {
    div.textContent = ta.value.slice(0, index)
    const span = document.createElement('span')
    span.textContent = ta.value.slice(index) || '.'
    div.appendChild(span)
    const top = span.offsetTop
    div.removeChild(span)
    return top
  }
  const cur = topAt(ta.selectionStart)
  const result = { atFirst: cur - topAt(0) < 2, atLast: topAt(ta.value.length) - cur < 2 }
  div.textContent = ''
  return result
}

/**
 * The 1-based number to display for an ordered-list item: its position within the current
 * run of same-level ordered siblings. Deeper children are skipped; a shallower level or a
 * non-ordered sibling at the same level ends the run (so each contiguous `1.`-list restarts).
 */
function orderedNumber(blocks: Block[], index: number): number {
  const level = blocks[index].level
  let n = 1
  for (let i = index - 1; i >= 0; i--) {
    const p = blocks[i]
    if (p.level < level) break
    if (p.level === level) {
      if (p.type === 'bullet' && p.ordered) n++
      else break
    }
  }
  return n
}

/**
 * Hierarchical (legal-style) label for an ordered item: prefixes the numbers of its
 * ordered ancestors, e.g. `1`, `1.1`, `1.1.1`, `2`, `2.1`. Nesting under a non-ordered
 * bullet starts a fresh chain (no prefix), so only ordered ancestors contribute a segment.
 */
function orderedLabel(blocks: Block[], index: number): string {
  const own = orderedNumber(blocks, index)
  const level = blocks[index].level
  if (level === 0) return String(own)
  let parent = -1
  for (let j = index - 1; j >= 0; j--) {
    if (blocks[j].level < level) {
      parent = j
      break
    }
  }
  if (parent >= 0 && blocks[parent].type === 'bullet' && blocks[parent].ordered) {
    return orderedLabel(blocks, parent) + '.' + own
  }
  return String(own)
}

/** The caret/selection to restore alongside a document state, so undo/redo lands the
 *  cursor exactly where the change happened — a text caret, or a block multi-selection. */
type EditorSel =
  | { kind: 'caret'; id: number; start: number; end: number }
  | { kind: 'blocks'; ids: number[] }
  | null
/** One undo/redo step: a document snapshot plus the selection that was active in it. */
interface Snapshot {
  blocks: Block[]
  sel: EditorSel
}

export function BlockEditor({ path }: { path: string }): React.JSX.Element {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const p = parseBlocks(useStore.getState().texts[path] ?? '')
    return p.blocks.length ? p.blocks : [makeBlock()]
  })
  // Open in rendered mode (links active, hover works); only auto-edit a brand-new empty note.
  const [editingId, setEditingId] = useState<number | null>(() =>
    blocks.length === 1 && blocks[0].type === 'paragraph' && blocks[0].text === '' ? blocks[0].id : null
  )
  const [zoomId, setZoomId] = useState<number | null>(null)
  const [ac, setAc] = useState<AcState | null>(null)
  // Block-level multi-selection (whole bullets, not text within one).
  const [selIds, setSelIds] = useState<Set<number>>(() => new Set())
  // In-note find & replace (⌘F), scoped to this editor's blocks. `idx` is the active match.
  const [find, setFind] = useState<{ q: string; r: string; idx: number } | null>(null)
  const [barStyle, setBarStyle] = useState<React.CSSProperties>({})
  const findInputRef = useRef<HTMLInputElement>(null)
  const wantFirstJump = useRef(false)
  const findRequest = useStore((s) => s.findRequest)

  const pendingCaret = useRef<{ id: number; pos: CaretPos; end?: CaretPos } | null>(null)
  // Set by ⌘⇧V (paste-as-is): the next paste skips markdown→block parsing and inserts
  // the clipboard text verbatim into the current field.
  const plainPasteRef = useRef(false)
  const taRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map())
  const dragRef = useRef<{ anchor: number } | null>(null)
  const anchorRef = useRef<number | null>(null)
  const outlinerRef = useRef<HTMLDivElement>(null)
  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])
  const lastCoalesceKey = useRef<string | null>(null)
  // Undo granularity for typing: a generation counter that bumps at word boundaries
  // (and when switching insert↔delete) so each word is its own undo step. `opSeq`
  // gives one-off edits (bold, bracket-wrap, completions) their own step.
  const coalesceGen = useRef(0)
  const lastOp = useRef<'ins' | 'del' | null>(null)
  const opSeq = useRef(0)
  // The body we last wrote, so we can tell our own saves from external changes.
  const lastBodyRef = useRef<string | null>(null)
  // Always-current blocks, for async callbacks (smart-title fetch) that outlive a render.
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  // Drag-reorder from the bullet handle (document listeners read these refs).
  const blockDragRef = useRef<{
    id: number
    startX: number
    startY: number
    origLevel: number
    active: boolean
  } | null>(null)
  const dropRef = useRef<{ beforeId: number | null; depth: number } | null>(null)
  const justDraggedRef = useRef(false)
  const zoomIdRef = useRef<number | null>(null)
  zoomIdRef.current = zoomId
  const [dropHint, setDropHint] = useState<{ top: number; left: number; width: number } | null>(null)

  const files = useStore((s) => s.files)
  const templates = useMemo(() => templatesFromFiles(files), [files])
  const matches = useMemo(() => findMatchesIn(blocks, find?.q ?? ''), [blocks, find?.q])
  const navigate = useStore((s) => s.navigate)
  const openTag = useStore((s) => s.openTag)
  const parsed = useStore((s) => s.parsed)
  const index = useStore((s) => s.index)
  const ensureEntity = useStore((s) => s.ensureEntity)
  const allPaths = useMemo(() => files.map((f) => f.path), [files])
  // Real filenames first (immediate as you type), then frontmatter aliases via the index.
  const resolveLink = (raw: string): string | null => resolveTarget(raw, allPaths) ?? index.resolvePath(raw)
  const isResolved = (raw: string): boolean => resolveLink(raw) !== null

  // Supertags: a `#tag` whose name matches a note under `Tags/` is a typed supertag.
  const supertagIndex = useMemo(() => buildSupertagIndex(supertagsFromParsed(parsed)), [parsed])
  /** Display name of the supertag a linked note carries (→ render it as a typed chip). */
  const supertagOf = (rawPage: string): string | undefined => {
    const p = resolveLink(rawPage)
    if (!p) return undefined
    return supertagsForNote(parsed[p]?.tags ?? [], supertagIndex)[0]?.name
  }
  // The typed-entity card currently expanded inline (path + viewport anchor).
  const [entityPop, setEntityPop] = useState<{ path: string; x: number; y: number } | null>(null)
  const expandEntity = (rawPage: string, x: number, y: number): void => {
    const p = resolveLink(rawPage)
    if (p) setEntityPop({ path: p, x, y })
  }

  // Spellcheck: re-render rendered blocks when a batch of check results lands (the
  // check itself runs in the main process; results are cached, so this settles fast).
  // `spellTick` also feeds the row memo so cached rows refresh their squiggles.
  const [spellTick, bumpSpell] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeSpell(bumpSpell), [])
  // Right-click menu for a misspelled word in a rendered block.
  const [spellMenu, setSpellMenu] = useState<{
    blockId: number
    word: string
    x: number
    y: number
    suggestions: string[]
  } | null>(null)
  const openSpellMenu = (blockId: number, word: string, x: number, y: number): void => {
    setSpellMenu({ blockId, word, x, y, suggestions: [] })
    void window.verso.suggestSpelling(word).then((suggestions) =>
      setSpellMenu((prev) =>
        prev && prev.blockId === blockId && prev.word === word ? { ...prev, suggestions } : prev
      )
    )
  }
  const applySpellFix = (blockId: number, word: string, replacement: string): void => {
    const blk = blocks.find((b) => b.id === blockId)
    if (blk) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      replaceText(blockId, blk.text.replace(re, replacement))
    }
    setSpellMenu(null)
  }
  const ignoreSpellWord = (word: string): void => {
    void window.verso.addToDictionary(word).then(() => resetSpell())
    setSpellMenu(null)
  }

  // Highlight a phrase + press `#` → pick a supertag to turn the selection into a typed
  // entity. `text`/`start`/`end` snapshot the block so applying is independent of focus.
  const [tagPick, setTagPick] = useState<
    { id: number; start: number; end: number; text: string; name: string; x: number; y: number; query: string; index: number } | null
  >(null)
  const applyTagPick = (tag: string): void => {
    const tp = tagPick
    setTagPick(null)
    if (!tp) return
    const name = tp.name.trim()
    if (!name) return
    const newText = tp.text.slice(0, tp.start) + `[[${name}]]` + tp.text.slice(tp.end)
    setEditingId(tp.id)
    pendingCaret.current = { id: tp.id, pos: tp.start + name.length + 4 } // after the closing ]]
    replaceText(tp.id, newText)
    void ensureEntity(name, tag)
  }

  // Snapshot the live caret/selection so an undo step can put the cursor back where the
  // change happened. Read synchronously at commit time — before `setBlocks` re-renders —
  // so it reflects the state being left, not the edit just made.
  const captureSel = (): EditorSel => {
    if (selIds.size) return { kind: 'blocks', ids: [...selIds] }
    if (editingId != null) {
      const ta = taRefs.current.get(editingId)
      if (ta) return { kind: 'caret', id: editingId, start: ta.selectionStart, end: ta.selectionEnd }
    }
    return null
  }
  // Restore a snapshot's caret/selection (the pendingCaret effect clamps + focuses).
  const applySel = (sel: EditorSel): void => {
    if (sel?.kind === 'blocks') {
      setEditingId(null)
      setSelIds(new Set(sel.ids))
      outlinerRef.current?.focus()
    } else if (sel?.kind === 'caret') {
      setSelIds(new Set())
      setEditingId(sel.id)
      pendingCaret.current = { id: sel.id, pos: sel.start, end: sel.end !== sel.start ? sel.end : undefined }
    } else {
      setSelIds(new Set())
    }
  }

  // Latest commit, for subscriptions created once per note (noteBus) — a plain
  // closure would go stale after the first structural change.
  const commitRef = useRef<(next: Block[], coalesceKey?: string) => void>(() => {})
  // Every structural change snapshots the prior blocks for undo. Consecutive
  // edits sharing a `coalesceKey` (e.g. typing in one block) fold into one step.
  const commit = (next: Block[], coalesceKey?: string): void => {
    const coalesce = coalesceKey != null && lastCoalesceKey.current === coalesceKey
    if (!coalesce) {
      undoStack.current.push({ blocks, sel: captureSel() })
      if (undoStack.current.length > 300) undoStack.current.shift()
      redoStack.current = []
    }
    lastCoalesceKey.current = coalesceKey ?? null
    const body = serializeBlocks(next, '')
    lastBodyRef.current = body
    setBlocks(next)
    useStore.getState().setNoteBody(path, body)
  }
  commitRef.current = commit

  const restore = (snap: Snapshot, from: 'undo' | 'redo'): void => {
    const current: Snapshot = { blocks, sel: captureSel() }
    if (from === 'undo') redoStack.current.push(current)
    else undoStack.current.push(current)
    lastCoalesceKey.current = null
    const body = serializeBlocks(snap.blocks, '')
    lastBodyRef.current = body
    setBlocks(snap.blocks)
    useStore.getState().setNoteBody(path, body)
    applySel(snap.sel)
  }
  const undo = (): void => {
    const snap = undoStack.current.pop()
    if (snap !== undefined) restore(snap, 'undo')
  }
  const redo = (): void => {
    const snap = redoStack.current.pop()
    if (snap !== undefined) restore(snap, 'redo')
  }

  const autoGrow = (ta: HTMLTextAreaElement): void => {
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }

  useEffect(() => {
    const pc = pendingCaret.current
    if (!pc) return
    const ta = taRefs.current.get(pc.id)
    if (ta) {
      ta.focus()
      const resolve = (cp: CaretPos): number => {
        const p = cp === 'start' ? 0 : cp === 'end' ? ta.value.length : cp
        return Math.max(0, Math.min(p, ta.value.length))
      }
      const a = resolve(pc.pos)
      ta.setSelectionRange(a, pc.end !== undefined ? resolve(pc.end) : a)
      autoGrow(ta)
    }
    pendingCaret.current = null
  })

  // Pin the find bar to the top of the editor's scroll viewport (position: fixed, measured
  // from the .scroll-area) so it never moves while cycling matches or scrolling the note.
  useLayoutEffect(() => {
    if (!find) return
    const update = (): void => {
      const sa = outlinerRef.current?.closest('.scroll-area') as HTMLElement | null
      if (!sa) return
      const r = sa.getBoundingClientRect()
      const width = Math.min(560, r.width - 24)
      setBarStyle({ position: 'fixed', top: Math.round(r.top + 10), left: Math.round(r.right - 12 - width), width })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [find !== null])

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
  const wantMatchIdx = useRef<number | null>(null)
  useEffect(() => {
    if (wantMatchIdx.current === null) return
    const target = wantMatchIdx.current
    wantMatchIdx.current = null
    if (matches.length) gotoMatch(target)
    else setFind((f) => (f ? { ...f, idx: -1 } : f))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  // Live insert from the PDF pane (highlights) into this note. Goes through
  // `commit` (via the ref, so it isn't stale) so the insert is a real undo step.
  useEffect(
    () =>
      noteBus.subscribe(path, (md) => {
        const add = parseBlocks(md).blocks
        if (!add.length) return
        commitRef.current([...cloneBlocks(blocksRef.current), ...add])
      }),
    [path]
  )

  // Re-sync when the note's text changes underneath us (file watcher, or an
  // anchor minted by `((`/`@` in another pane) — but never while actively editing.
  const externalText = useStore((s) => s.texts[path] ?? '')
  useEffect(() => {
    const body = parseFrontmatter(externalText).body
    if (lastBodyRef.current !== null && body.trim() === lastBodyRef.current.trim()) return
    if (editingId !== null) return // don't clobber an in-progress edit
    const parsed = parseBlocks(externalText)
    const nb = parsed.blocks.length ? parsed.blocks : [makeBlock()]
    lastBodyRef.current = serializeBlocks(nb, '')
    setBlocks(nb)
    setSelIds(new Set())
    // The re-parse mints new block ids, so prior undo snapshots no longer apply —
    // drop them rather than let undo restore stale content after an external change.
    undoStack.current = []
    redoStack.current = []
    lastCoalesceKey.current = null
  }, [externalText, editingId, path])

  // ---- multi-selection (whole blocks) ----
  // Visible block ids spanning two endpoints, inclusive, in document order.
  // Reads `blocksRef` (not the render closure) so the document-level drag listeners
  // below can be subscribed once instead of re-bound on every blocks change.
  const visibleIdsBetween = (a: number, b: number): Set<number> => {
    const vis = visibleBlocks(blocksRef.current)
    const ia = vis.findIndex((v) => v.block.id === a)
    const ib = vis.findIndex((v) => v.block.id === b)
    if (ia < 0 || ib < 0) return new Set([a])
    const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia]
    return new Set(vis.slice(lo, hi + 1).map((v) => v.block.id))
  }

  // Block indices covered by the selection, each expanded to include its
  // collapsed descendants, sorted ascending.
  const selectedIndices = (): number[] => {
    const idxs = new Set<number>()
    for (const id of selIds) {
      const i = indexOfBlock(blocks, id)
      if (i < 0) continue
      idxs.add(i)
      const [s, e] = childrenRange(blocks, i)
      for (let k = s; k < e; k++) idxs.add(k)
    }
    return [...idxs].sort((a, b) => a - b)
  }

  const deleteSelected = (): void => {
    const idxs = selectedIndices()
    if (!idxs.length) return
    const drop = new Set(idxs)
    const next = blocks.filter((_, i) => !drop.has(i))
    setSelIds(new Set())
    setEditingId(null)
    commit(next.length ? next : [makeBlock()])
  }

  // Indent/outdent every selected list item together, preserving relative depth.
  const shiftSelected = (delta: -1 | 1): void => {
    const idxs = selectedIndices()
    if (!idxs.length) return
    let expandIdx = -1
    if (delta === 1) {
      // Same cap as a single indent: at most one deeper than the item visibly above.
      const first = blocks[idxs[0]]
      const vis = visibleBlocks(blocks)
      const vi = vis.findIndex((v) => v.index === idxs[0])
      const prev = vi > 0 ? vis[vi - 1] : undefined
      if (!prev || !isList(prev.block)) return
      if (isList(first) && first.level > prev.block.level) return
      if (prev.block.collapsed && isList(first) && first.level === prev.block.level)
        expandIdx = prev.index // don't let the selection vanish into a folded parent
    }
    const next = cloneBlocks(blocks)
    let changed = false
    for (const i of idxs) {
      if (!isList(next[i])) continue
      if (delta === -1 && next[i].level === 0) continue
      next[i] = { ...next[i], level: next[i].level + delta }
      changed = true
    }
    if (changed && expandIdx >= 0) next[expandIdx] = { ...next[expandIdx], collapsed: false }
    if (changed) commit(next)
  }

  const copySelected = (cut: boolean): void => {
    const idxs = selectedIndices()
    if (!idxs.length) return
    const sel = idxs.map((i) => blocks[i])
    const md = serializeBlocks(sel, '').replace(/\n+$/, '')
    blockClip.set(sel, md) // structured copy (keeps anchors) alongside the text
    void navigator.clipboard?.writeText(md)
    if (cut) deleteSelected()
  }

  // Paste whole blocks copied/cut from any note.
  const pasteBlocks = (afterId: number, src: Block[]): void => {
    if (!src.length) return
    const fresh = src.map((sb) =>
      makeBlock({
        type: sb.type,
        text: sb.text,
        level: sb.level,
        checked: sb.checked,
        ordered: sb.ordered,
        lang: sb.lang,
        collapsed: false
      })
    )
    const next = cloneBlocks(blocks)
    const idx = afterId >= 0 ? indexOfBlock(next, afterId) : next.length - 1
    if (idx >= 0 && next[idx]?.type === 'paragraph' && next[idx].text === '') {
      next.splice(idx, 1, ...fresh) // replace an empty target paragraph
    } else {
      next.splice(idx + 1, 0, ...fresh)
    }
    setEditingId(null)
    setSelIds(new Set())
    pendingCaret.current = null
    commit(next)
  }

  // Block paste from a raw paste event, if the system clipboard still holds our copy.
  const tryPasteBlocks = (e: { clipboardData: DataTransfer | null }, afterId: number): boolean => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    const clip = blockClip.match(text)
    if (!clip) return false
    pasteBlocks(afterId, clip)
    return true
  }

  // Paste plain markdown text into the field `b`, parsing it into blocks so that
  // pasted lists/headings become real list/heading blocks (a single textarea can't
  // hold multiple blocks). Returns false when there's nothing to split — single-line
  // pastes fall through to the native insert (and onChange's shortcut detection).
  const pasteText = (b: Block, ta: HTMLTextAreaElement, text: string): boolean => {
    const parsed = parseBlocks(text).blocks
    // One-block paste with no newline: let the textarea insert it natively; a leading
    // `1. ` / `- ` / `# ` is then picked up by detectShortcut in onChange.
    if (parsed.length <= 1 && !text.includes('\n')) return false
    if (!parsed.length) return false
    const before = ta.value.slice(0, ta.selectionStart)
    const after = ta.value.slice(ta.selectionEnd)
    const fresh = parsed.map((p) =>
      makeBlock({
        type: p.type,
        text: p.text,
        level: p.level,
        checked: p.checked,
        ordered: p.ordered,
        lang: p.lang
      })
    )
    // Keep any text typed before/after the caret around the pasted blocks.
    fresh[0].text = before + fresh[0].text
    const last = fresh[fresh.length - 1]
    const caretPos = last.text.length
    last.text += after
    const next = cloneBlocks(blocks)
    const idx = indexOfBlock(next, b.id)
    if (idx < 0) return false
    next.splice(idx, 1, ...fresh)
    setSelIds(new Set())
    setEditingId(last.id)
    pendingCaret.current = { id: last.id, pos: caretPos }
    commit(next)
    return true
  }

  // Visible blocks in the current view (zoom-scoped when zoomed in).
  const visibleInView = (): { block: Block; index: number }[] => {
    let vis: { block: Block; index: number }[] = visibleBlocks(blocks)
    const zi = zoomId != null ? indexOfBlock(blocks, zoomId) : -1
    if (zi >= 0) {
      const [s, e] = childrenRange(blocks, zi)
      vis = vis.filter((v) => v.index === zi || (v.index >= s && v.index < e))
    }
    return vis
  }

  const selectAll = (): void => {
    setEditingId(null)
    window.getSelection()?.removeAllRanges()
    setSelIds(new Set(visibleInView().map((v) => v.block.id)))
    outlinerRef.current?.focus()
  }

  // ⌥⌘↑ / ⌥⌘↓ — collapse/expand every foldable block in the current view, as ONE
  // undo step. The zoom root itself is never folded (that would hide the whole view).
  const foldAllInView = (collapse: boolean): void => {
    const zi = zoomId != null ? indexOfBlock(blocks, zoomId) : -1
    const [s, e] = zi >= 0 ? childrenRange(blocks, zi) : [0, blocks.length]
    const next = cloneBlocks(blocks)
    let changed = false
    for (let i = s; i < e; i++) {
      if (next[i].collapsed !== collapse && foldableAt(next, i)) {
        next[i] = { ...next[i], collapsed: collapse }
        changed = true
      }
    }
    if (!changed) return
    commit(next)
    // If the fold hid the block being edited, its textarea unmounts and focus would
    // fall to <body>, killing keyboard handling — hand it to the outliner instead.
    if (collapse && editingId != null && !visibleBlocks(next).some((v) => v.block.id === editingId)) {
      setEditingId(null)
      window.getSelection()?.removeAllRanges()
      outlinerRef.current?.focus()
    }
  }

  // Shift+Arrow: grow/shrink the selection from the anchor.
  const extendSelection = (dir: -1 | 1): void => {
    const ids = visibleBlocks(blocks).map((v) => v.block.id)
    const ai = ids.indexOf(anchorRef.current ?? -1)
    if (ai < 0) return
    const selPos = ids.map((id, i) => (selIds.has(id) ? i : -1)).filter((i) => i >= 0)
    if (!selPos.length) return
    const focus = dir < 0 ? Math.min(...selPos) : Math.max(...selPos)
    const nf = Math.max(0, Math.min(ids.length - 1, focus + dir))
    const [lo, hi] = ai <= nf ? [ai, nf] : [nf, ai]
    setSelIds(new Set(ids.slice(lo, hi + 1)))
  }

  // Plain Arrow in selection mode (Logseq): move the highlight to a single
  // adjacent block, staying in selection mode.
  const navigateSelection = (dir: -1 | 1): void => {
    const ids = visibleBlocks(blocks).map((v) => v.block.id)
    const selPos = ids.map((id, i) => (selIds.has(id) ? i : -1)).filter((i) => i >= 0)
    if (!selPos.length) return
    const edge = dir < 0 ? Math.min(...selPos) : Math.max(...selPos)
    const ni = Math.max(0, Math.min(ids.length - 1, edge + dir))
    anchorRef.current = ids[ni]
    setSelIds(new Set([ids[ni]]))
  }

  // Enter in selection mode resumes editing the (top) selected block.
  const enterEditFromSelection = (): void => {
    const sel = visibleBlocks(blocks).filter((v) => selIds.has(v.block.id))
    if (!sel.length) return
    setSelIds(new Set())
    setEditingId(sel[0].block.id)
    pendingCaret.current = { id: sel[0].block.id, pos: 'end' }
  }

  // Cmd+Shift+Arrow in selection mode: move the whole selected range together.
  // The range extends over the last block's hidden (collapsed) children so they
  // travel along instead of being stranded / re-parented.
  const moveSelected = (dir: -1 | 1): void => {
    const idxs = selectedIndices()
    if (!idxs.length) return
    const lo = idxs[0]
    const hi = childrenRange(blocks, idxs[idxs.length - 1])[1]
    const next = moveUnit(blocks, lo, hi, dir)
    if (next) commit(next)
  }

  // ⌘↑/⌘↓ in selection mode: collapse/expand every foldable selected block.
  const foldSelected = (dir: -1 | 1): void => {
    const idxs = selectedIndices()
    const collapse = dir < 0
    const next = cloneBlocks(blocks)
    let changed = false
    for (const i of idxs) {
      if (next[i].collapsed !== collapse && foldableAt(next, i)) {
        next[i] = { ...next[i], collapsed: collapse }
        changed = true
      }
    }
    if (changed) commit(next)
  }

  // Begin a block selection from a focused/edited bullet (keyboard entry point).
  const startBlockSelection = (id: number, dir: -1 | 1): void => {
    const vis = visibleBlocks(blocks)
    const vi = vis.findIndex((v) => v.block.id === id)
    const neighbor = vis[vi + dir]
    anchorRef.current = id
    setEditingId(null)
    window.getSelection()?.removeAllRanges()
    setSelIds(visibleIdsBetween(id, neighbor ? neighbor.block.id : id))
    outlinerRef.current?.focus()
  }

  const onRowMouseDown = (b: Block, e: React.MouseEvent): void => {
    if (e.shiftKey) {
      // Extend a block selection from the anchor to the clicked row.
      e.preventDefault()
      const anchor = anchorRef.current ?? b.id
      anchorRef.current = anchor
      setEditingId(null)
      window.getSelection()?.removeAllRanges()
      setSelIds(visibleIdsBetween(anchor, b.id))
      outlinerRef.current?.focus()
      return
    }
    anchorRef.current = b.id
    dragRef.current = { anchor: b.id }
    if (selIds.size) setSelIds(new Set())
    setEditingId(b.id)
    // Land the caret where the click fell; clicking the empty area past the text → end.
    const off = caretOffsetAt(e.currentTarget as HTMLElement, e.clientX, e.clientY)
    pendingCaret.current = { id: b.id, pos: off === null ? 'end' : Math.min(off, b.text.length) }
  }

  // Clicking the empty space below the last block puts the caret at the end — reusing a
  // trailing empty line if there is one, otherwise adding a fresh paragraph to type in.
  const onTailMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (selIds.size) setSelIds(new Set())
    const last = blocks[blocks.length - 1]
    if (last && last.text === '' && last.type !== 'code' && last.type !== 'table') {
      setEditingId(last.id)
      pendingCaret.current = { id: last.id, pos: 'end' }
      return
    }
    const fresh = makeBlock({ type: 'paragraph', text: '' })
    pendingCaret.current = { id: fresh.id, pos: 'start' }
    setEditingId(fresh.id)
    commit([...cloneBlocks(blocks), fresh])
  }

  const onContainerKeyDown = (e: React.KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === ';') return e.preventDefault(), insertTimestamp()
    if (mod && (e.key === 'f' || e.key === 'F')) return e.preventDefault(), openFind()
    if (mod && (e.key === 'g' || e.key === 'G'))
      return e.preventDefault(), void (matches.length && gotoMatch((find?.idx ?? -1) + (e.shiftKey ? -1 : 1)))
    if (mod && (e.key === 'z' || e.key === 'Z')) return e.preventDefault(), void (e.shiftKey ? redo() : undo())
    if (mod && e.key === 'y') return e.preventDefault(), redo()
    if (mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))
      return e.preventDefault(), foldAllInView(e.key === 'ArrowUp')
    if (selIds.size === 0) return
    if (e.key === 'Escape') return setSelIds(new Set())
    if (e.key === 'Backspace' || e.key === 'Delete') return e.preventDefault(), deleteSelected()
    if (e.key === 'Tab') return e.preventDefault(), shiftSelected(e.shiftKey ? -1 : 1)
    if (mod && (e.key === 'c' || e.key === 'x')) return e.preventDefault(), copySelected(e.key === 'x')
    if (mod && (e.key === 'a' || e.key === 'A')) return e.preventDefault(), selectAll() // ⌘⇧A / ⌘A
    if (e.key === 'Enter') return e.preventDefault(), enterEditFromSelection()
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? -1 : 1
      if (mod && e.shiftKey) moveSelected(dir) // ⌘⇧↑/↓ — move blocks
      else if (mod) foldSelected(dir) // ⌘↑ collapse / ⌘↓ expand
      else if (e.altKey || e.shiftKey) extendSelection(dir) // ⌥↑/↓ (or ⇧) — extend
      else navigateSelection(dir) // plain ↑/↓ — move highlight
    }
  }

  // Drag across rows → select whole blocks (once the pointer leaves the anchor).
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      if (e.buttons === 0) {
        dragRef.current = null
        return
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const row = el?.closest('[data-block-id]') as HTMLElement | null
      if (!row) return
      const overId = Number(row.dataset.blockId)
      if (overId === drag.anchor) {
        // Still within the anchor block: let native text selection happen.
        setSelIds((prev) => (prev.size ? new Set() : prev))
        return
      }
      window.getSelection()?.removeAllRanges()
      setEditingId(null)
      setSelIds(visibleIdsBetween(drag.anchor, overId))
      outlinerRef.current?.focus()
    }
    const onUp = (): void => {
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    // visibleIdsBetween reads blocksRef, so the handlers never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- drag-reorder (from the bullet/number handle; a plain click still zooms) ----
  const onHandleMouseDown = (b: Block, e: React.MouseEvent): void => {
    if (!isList(b) || e.button !== 0) return
    e.preventDefault() // no text selection during the drag; click (zoom/toggle) still fires
    blockDragRef.current = { id: b.id, startX: e.clientX, startY: e.clientY, origLevel: b.level, active: false }
  }

  // Document-level drag listeners (subscribed once; read refs, never render closures).
  // The dragged subtree swaps position via a drop gap between VISIBLE rows; the drop
  // depth is clamped to [below.level, above.level+1] (never deeper than one past the
  // row above) with dotflowy-style nest resistance: gaining a level takes deliberate
  // rightward travel (60px), shedding one stays easy (24px).
  useEffect(() => {
    const GAIN_PX = 24 / 0.4
    const SHED_PX = 24
    const clear = (): void => {
      blockDragRef.current = null
      dropRef.current = null
      setDropHint(null)
    }
    const onMove = (e: MouseEvent): void => {
      const d = blockDragRef.current
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
      if (beforeRaw > sIdx && beforeRaw < sEnd) {
        dropRef.current = null
        setDropHint(null)
        return
      }
      // When zoomed, nothing may drop above the zoom root (that leaves the view).
      const zi = zoomIdRef.current != null ? indexOfBlock(src, zoomIdRef.current) : -1
      if (zi >= 0 && beforeRaw <= zi) {
        dropRef.current = null
        setDropHint(null)
        return
      }
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
      if (minD > maxD) {
        dropRef.current = null
        setDropHint(null)
        return
      }
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
      const rebase = (isList(anchorBlock) ? anchorBlock.level : 0) - pad / 24
      const left = ar.left - pad + Math.max(0, depth - rebase) * 24 + 38
      const top = beforeEl ? ar.top : aboveEl ? aboveEl.getBoundingClientRect().bottom : ar.bottom
      setDropHint({ top: top - 1, left, width: Math.max(60, ar.right - left) })
    }
    const finish = (apply: boolean): void => {
      const d = blockDragRef.current
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
      if (e.key === 'Escape' && blockDragRef.current?.active) finish(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Smart link title: after a bare URL is pasted into an otherwise-empty block, fetch the
  // page title and upgrade it to `[Title](url)`. Only acts if the block is still just the
  // URL (so it never disturbs text you went on to type), and reads live blocks via the ref.
  const smartTitlePaste = (blockId: number, url: string): void => {
    if (!useStore.getState().smartLinkTitles) return // privacy toggle (Settings)
    void window.verso.fetchTitle(url).then((title) => {
      if (!title) return
      const cur = blocksRef.current
      const idx = indexOfBlock(cur, blockId)
      if (idx < 0 || cur[idx].text.trim() !== url) return
      const md = `[${title.replace(/[[\]]/g, '')}](${url})`
      const next = cloneBlocks(cur)
      next[idx] = { ...next[idx], text: md }
      undoStack.current.push({ blocks: cur, sel: null })
      redoStack.current = []
      lastCoalesceKey.current = null
      const body = serializeBlocks(next, '')
      lastBodyRef.current = body
      setBlocks(next)
      useStore.getState().setNoteBody(path, body)
      if (editingId === blockId) pendingCaret.current = { id: blockId, pos: md.length }
    })
  }

  /** The block id of the embed for video `key` in this note, or null. */
  const findVideoBlockId = (key: string): number | null => {
    for (const b of blocks) {
      const t = b.text.trim()
      const vm = t.match(/^\{\{video\s+(\S+)\}\}$/i)
      const url = vm ? vm[1] : /^https?:\/\/\S+$/.test(t) ? t : null
      const v = url ? parseVideoUrl(url) : null
      if (v && videoKey(v) === key) return b.id
    }
    return null
  }

  // Keyboard shortcut (⌘/Ctrl+;): stamp the current play time of the video you're watching.
  // If you're typing in a block it inserts the link at the caret (so you can keep typing);
  // otherwise it appends a timestamped note under the video, like the embed button.
  const insertTimestamp = (): void => {
    const key = activePlayerKey()
    if (!key) return
    const seconds = Math.floor(currentTime(key) ?? 0)
    if (editingId != null) {
      const ta = taRefs.current.get(editingId)
      const blk = blocks.find((b) => b.id === editingId)
      if (ta && blk) {
        const link = `[${formatTimestamp(seconds)}](video-seek:${key}:${seconds}) `
        const next = blk.text.slice(0, ta.selectionStart) + link + blk.text.slice(ta.selectionEnd)
        pendingCaret.current = { id: editingId, pos: ta.selectionStart + link.length }
        replaceText(editingId, next)
        return
      }
    }
    const vb = findVideoBlockId(key)
    if (vb != null) addVideoTimestamp(vb, key, seconds)
  }

  // Insert a timestamped note under a video embed: a clickable [m:ss](video-seek:…) link
  // that seeks the player, leaving the caret after it so you can type the note.
  const addVideoTimestamp = (videoBlockId: number, key: string, seconds: number): void => {
    const vIdx = indexOfBlock(blocks, videoBlockId)
    if (vIdx < 0) return
    const link = `[${formatTimestamp(seconds)}](video-seek:${key}:${seconds}) `
    const vLevel = blocks[vIdx].level

    // (3) If the caret is already on an empty bullet, fill that one instead of adding another.
    if (editingId != null) {
      const ci = indexOfBlock(blocks, editingId)
      if (ci >= 0 && blocks[ci].text.trim() === '') {
        const next = cloneBlocks(blocks)
        next[ci] = { ...next[ci], type: 'bullet', text: link }
        pendingCaret.current = { id: blocks[ci].id, pos: 'end' }
        commit(next)
        return
      }
    }

    // (2) Otherwise append below the notes already attached to this video (newest at the
    //     bottom), skipping past the contiguous run of timestamp notes / empty bullets.
    const isNote = (b: Block): boolean =>
      b.level >= vLevel && (b.text.trim() === '' || /\]\(video-seek:/.test(b.text))
    let end = vIdx + 1
    while (end < blocks.length && isNote(blocks[end])) end++
    const next = cloneBlocks(blocks)
    const block = makeBlock({ type: 'bullet', level: vLevel, text: link })
    next.splice(end, 0, block)
    setEditingId(block.id)
    pendingCaret.current = { id: block.id, pos: 'end' }
    commit(next)
  }

  // ---- ops (flat, immutable) ----
  const patchById = (id: number, patch: Partial<Block>, caret?: CaretPos, coalesceKey?: string): void => {
    const next = cloneBlocks(blocks)
    const idx = indexOfBlock(next, id)
    if (idx < 0) return
    next[idx] = { ...next[idx], ...patch }
    if (caret !== undefined) pendingCaret.current = { id, pos: caret }
    commit(next, coalesceKey)
  }

  // Typing edit — coalesces within the current word (see `coalesceGen`).
  const setText = (id: number, text: string): void =>
    patchById(id, { text }, undefined, `text:${id}#${coalesceGen.current}`)

  // One-off text replacement (bold, bracket-wrap, completions) — always its own undo
  // step. Set `pendingCaret` before calling if you need to place the caret/selection.
  const replaceText = (id: number, text: string): void => patchById(id, { text }, undefined, `op:${++opSeq.current}`)

  const insertAfter = (id: number, before: string, after: string): void => {
    const next = cloneBlocks(blocks)
    const idx = indexOfBlock(next, id)
    if (idx < 0) return
    const cur = next[idx]
    const [, secEnd] = childrenRange(next, idx)
    const hasKids = secEnd > idx + 1
    // Where the new line goes (Logseq semantics):
    // - collapsed parent → next sibling AFTER the whole hidden subtree (never dive
    //   into or re-parent the folded children);
    // - expanded list parent with children → new FIRST CHILD;
    // - the zoomed-in root also nests one deeper (a same-level sibling would land
    //   outside the zoom scope and be invisible);
    // - otherwise → next sibling right below.
    const foldedAway = cur.collapsed && hasKids
    const childOfZoom = id === zoomId && isList(cur)
    const asChild = isList(cur) && !foldedAway && (hasKids || childOfZoom)
    const insertIdx = foldedAway ? secEnd : idx + 1
    const childLevel = cur.level + 1
    let fresh: Block
    if (cur.type === 'heading') {
      // Splitting a heading: each non-empty side stays a heading; an empty side (e.g.
      // pressing Enter at the very start or end) becomes a plain paragraph. This keeps
      // the heading text styled and moves it down instead of stranding an empty heading.
      next[idx] = before ? { ...cur, text: before } : { ...cur, type: 'paragraph', level: 0, text: '' }
      fresh = after
        ? makeBlock({ type: 'heading', level: cur.level, text: after })
        : makeBlock({ type: 'paragraph', text: after })
    } else {
      next[idx] = { ...cur, text: before }
      fresh =
        cur.type === 'bullet'
          ? makeBlock({ type: 'bullet', ordered: cur.ordered, level: asChild ? childLevel : cur.level, text: after })
          : cur.type === 'task'
            ? makeBlock({ type: 'task', level: asChild ? childLevel : cur.level, checked: false, text: after })
            : makeBlock({ type: 'paragraph', text: after })
    }
    next.splice(insertIdx, 0, fresh)
    pendingCaret.current = { id: fresh.id, pos: 'start' }
    setEditingId(fresh.id)
    commit(next)
  }

  // ---- find & replace (⌘F), scoped to this note ----
  // Expand any collapsed ancestors so a matched block is actually visible before we jump.
  const revealBlock = (idx: number): void => {
    setBlocks((prev) => {
      let changed = false
      const next = [...prev]
      let need = prev[idx]?.level ?? 0
      for (let i = idx - 1; i >= 0 && need > 0; i--) {
        if (next[i].level < need) {
          if (next[i].collapsed) {
            next[i] = { ...next[i], collapsed: false }
            changed = true
          }
          need = next[i].level
        }
      }
      return changed ? next : prev
    })
  }

  // Scroll match `i` (wrapping) into view and highlight it in place. Crucially we do NOT
  // focus the block — focus stays in the find box so Enter/⌘G keep cycling instead of
  // editing the note. The active match is highlighted via <mark> in the rendered block.
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
      findInputRef.current?.focus() // keep the keyboard in the find box
    })
  }

  const openFind = (): void => {
    setFind((f) => f ?? { q: '', r: '', idx: -1 })
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }
  // Close the bar. If `landAtMatch`, drop the caret into the active match so you can edit it.
  const closeFind = (landAtMatch = false): void => {
    const m = find && find.idx >= 0 && find.idx < matches.length ? matches[find.idx] : null
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
    requestAnimationFrame(() => findInputRef.current?.focus())
  }

  // Replace every occurrence across the note as a single undo step.
  const replaceAll = (): void => {
    if (!find?.q) return
    let count = 0
    const next = blocks.map((b) => {
      const re = new RegExp(escapeRegExp(find.q), 'gi')
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
      if (matches.length) gotoMatch((find?.idx ?? -1) + (e.shiftKey ? -1 : 1))
    }
  }

  // While zoomed into a list item, the view only shows that item's deeper descendants,
  // so nothing may outdent to (or below) the zoom root's level — that would pop it out of
  // the zoomed pane and strand it. The minimum level allowed inside the current zoom.
  const zoomMinLevel = (): number => {
    if (zoomId == null) return 0
    const zb = blocks[indexOfBlock(blocks, zoomId)]
    return zb && isList(zb) ? zb.level + 1 : 0
  }

  // Shift a list item AND its descendants by `delta` levels (Logseq-style: children
  // move with the parent), in place — never repositioned.
  const shiftSubtree = (id: number, delta: -1 | 1, caret: number): void => {
    const idx = indexOfBlock(blocks, id)
    const b = blocks[idx]
    if (!b || !isList(b)) return
    let expandIdx = -1
    if (delta === 1) {
      // Can only indent one past the item *visibly* above. (The raw previous block may
      // be a hidden child of a collapsed subtree — capping on it allows runaway nesting.)
      const vis = visibleBlocks(blocks)
      const vi = vis.findIndex((v) => v.index === idx)
      const prev = vi > 0 ? vis[vi - 1] : undefined
      const max = prev && isList(prev.block) ? prev.block.level + 1 : 0
      if (b.level + 1 > max) return
      // Becoming a child of a collapsed item would hide the subtree — expand it.
      if (prev && prev.block.collapsed && b.level === prev.block.level) expandIdx = prev.index
    } else if (b.level <= zoomMinLevel()) return
    const [, e] = childrenRange(blocks, idx)
    const next = cloneBlocks(blocks)
    for (let k = idx; k < e; k++) if (isList(next[k])) next[k] = { ...next[k], level: next[k].level + delta }
    if (expandIdx >= 0) next[expandIdx] = { ...next[expandIdx], collapsed: false }
    pendingCaret.current = { id, pos: caret }
    commit(next)
  }
  const indent = (id: number, caret: number): void => shiftSubtree(id, 1, caret)
  const outdent = (id: number, caret: number): void => shiftSubtree(id, -1, caret)

  const mergeUp = (id: number): void => {
    const idx = indexOfBlock(blocks, id)
    const b = blocks[idx]
    if (!b) return
    // Backspace at start: outdent a nested item, un-style a styled one, else merge.
    if (isList(b) && b.level > 0) return outdent(id, 0)
    if (b.type !== 'paragraph') {
      return patchById(id, { type: 'paragraph', level: 0, checked: undefined, ordered: undefined }, 0)
    }
    const vis = visibleBlocks(blocks)
    const vi = vis.findIndex((v) => v.block.id === id)
    if (vi <= 0) return
    const prevId = vis[vi - 1].block.id
    const next = cloneBlocks(blocks)
    const pIdx = indexOfBlock(next, prevId)
    const cIdx = indexOfBlock(next, id)
    const joinPos = next[pIdx].text.length
    next[pIdx] = { ...next[pIdx], text: next[pIdx].text + next[cIdx].text }
    next.splice(cIdx, 1)
    pendingCaret.current = { id: prevId, pos: joinPos }
    setEditingId(prevId)
    commit(next)
  }

  // Move a block and its descendants up/down one sibling (carries children; swaps
  // whole subtrees via moveUnit, so it never interleaves into a neighbour's children).
  const move = (id: number, dir: -1 | 1, caret: number): void => {
    const idx = indexOfBlock(blocks, id)
    if (idx < 0) return
    const [, e] = childrenRange(blocks, idx)
    const next = moveUnit(blocks, idx, e, dir)
    if (!next) return
    pendingCaret.current = { id, pos: caret }
    commit(next)
  }

  const toggleCollapse = (id: number): void => {
    const idx = indexOfBlock(blocks, id)
    if (idx < 0 || !foldableAt(blocks, idx)) return
    patchById(id, { collapsed: !blocks[idx].collapsed })
  }

  const toggleTask = (id: number): void => {
    const b = blocks[indexOfBlock(blocks, id)]
    if (b?.type === 'task') patchById(id, { checked: !b.checked })
  }

  const focusAdjacent = (id: number, dir: -1 | 1, pos: CaretPos): void => {
    const vis = visibleBlocks(blocks)
    const vi = vis.findIndex((v) => v.block.id === id)
    const target = vis[vi + dir]
    if (!target) return
    setEditingId(target.block.id)
    pendingCaret.current = { id: target.block.id, pos }
  }

  // ---- assets ----
  const insertAssetBlocks = (afterId: number, mds: string[]): void => {
    if (!mds.length) return
    const next = cloneBlocks(blocks)
    const idx = indexOfBlock(next, afterId)
    const fresh = mds.map((md) => makeBlock({ type: 'paragraph', text: md }))
    if (idx >= 0) next.splice(idx + 1, 0, ...fresh)
    else next.push(...fresh)
    commit(next)
  }
  const handleFiles = async (files: FileList, afterId: number): Promise<void> => {
    const mds: string[] = []
    for (const file of Array.from(files)) {
      try {
        const rel = await window.verso.saveAsset(file.name, await fileToBase64(file))
        if (rel) mds.push(file.type.startsWith('image/') ? `![${file.name}](${rel})` : `[${file.name}](${rel})`)
      } catch (err) {
        console.error(`Failed to save asset ${file.name}:`, err)
      }
    }
    if (mds.length) insertAssetBlocks(afterId, mds)
  }

  // ---- autocomplete (`[[` page links) ----
  // When two notes share a name, a bare [[Name]] is ambiguous (it resolves to the
  // shortest path), so we insert the full path for the colliding ones and always
  // show the folder in the dropdown to tell them apart.
  const acItems = (state: AcState): AcSuggestion[] => {
    const q = state.query.toLowerCase()
    if (state.kind === 'slash-menu') {
      return SLASH_COMMANDS.filter((c) => c.label.toLowerCase().includes(q)).map((c) => ({
        key: c.cmd,
        label: c.label,
        icon: c.icon,
        cmd: c.cmd
      }))
    }
    if (state.kind === 'slash-template') {
      const list = templates
        .filter((t) => t.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((t) => ({ key: t.path, label: t.name, icon: '▤', tplPath: t.path }))
      return list.length ? list : [{ key: '__none__', label: 'No templates — add .md files to Templates/', icon: '▤' }]
    }
    const nameCounts = new Map<string, number>()
    for (const f of files) nameCounts.set(f.name.toLowerCase(), (nameCounts.get(f.name.toLowerCase()) ?? 0) + 1)
    const fileHits = files
      .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 8)
      .map((f) => {
        const ambiguous = (nameCounts.get(f.name.toLowerCase()) ?? 0) > 1
        return {
          key: f.path,
          label: f.name,
          icon: '[[ ]]',
          sub: dirname(f.path),
          excerpt: parsed[f.path]?.excerpt,
          insert: ambiguous ? stripMd(f.path) : f.name
        }
      })
    // Frontmatter aliases that match — inserting the alias links via the alias index.
    const aliasHits: AcSuggestion[] = index
      .aliasList()
      .filter((a) => a.alias.toLowerCase().includes(q))
      .slice(0, 4)
      .map((a) => ({ key: `alias:${a.alias}`, label: a.alias, icon: '[[ ]]', sub: `→ ${a.name}`, insert: a.alias }))
    return [...fileHits, ...aliasHits].slice(0, 10)
  }
  // Recomputed only when the popup or its inputs change; onKeyDown and the row popup
  // both read this instead of re-scanning all files on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const acList = useMemo(() => (ac ? acItems(ac) : []), [ac, files, templates, parsed, index])

  const applyItem = (id: number, item: AcSuggestion): void => {
    if (item.cmd) return runSlash(id, item.cmd)
    if (item.tplPath) return void insertTemplate(id, item.tplPath)
    if (item.insert === undefined) return // placeholder row (e.g. "No templates")
    const ta = taRefs.current.get(id)
    if (!ta) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const after = ta.value.slice(pos)
    const start = before.lastIndexOf('[[')
    const newBefore = before.slice(0, start) + `[[${item.insert}]]`
    pendingCaret.current = { id, pos: newBefore.length }
    setAc(null)
    replaceText(id, newBefore + after)
  }

  /** Run a `/` menu command on the block whose text is the `/…` query. */
  const runSlash = (id: number, cmd: string): void => {
    if (cmd === 'template') {
      // Second stage: keep a lone `/` (so typing keeps filtering) and list templates.
      setText(id, '/')
      pendingCaret.current = { id, pos: 1 }
      setAc({ id, query: '', index: 0, kind: 'slash-template' })
      return
    }
    setAc(null)
    if (cmd === 'table') return patchById(id, { type: 'table', text: TABLE_TEMPLATE }, 0)
    if (cmd === 'query') return patchById(id, { text: '{{query }}' }, 8)
    if (cmd === 'base') return patchById(id, { text: '{{base }}' }, 7)
    if (cmd === 'todo') return patchById(id, { type: 'task', checked: false, text: '' }, 0)
    if (cmd === 'bullet') return patchById(id, { type: 'bullet', ordered: false, text: '' }, 0)
    if (cmd === 'numbered') return patchById(id, { type: 'bullet', ordered: true, text: '' }, 0)
    if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3')
      return patchById(id, { type: 'heading', level: Number(cmd[1]), text: '' }, 0)
  }

  /** Apply a template to the CURRENT note: merge its properties + insert its body. */
  const insertTemplate = async (id: number, tplPath: string): Promise<void> => {
    setAc(null)
    let raw: string
    try {
      raw = (await window.verso.readNote(tplPath))?.text ?? ''
    } catch (err) {
      console.error(`Failed to read template ${tplPath}:`, err)
      return
    }
    const title = files.find((f) => f.path === path)?.name ?? stripMd(basename(path))
    const applied = applyTemplate(raw, title, new Date())
    const { data: tplFm, body } = parseFrontmatter(applied)
    // Merge the template's frontmatter properties into this note — the note's own
    // existing values win, so re-applying never wipes data you've filled in.
    if (Object.keys(tplFm).length) {
      const noteFm = parseFrontmatter(useStore.getState().texts[path] ?? '').data
      await useStore.getState().setNoteProperties(path, { ...tplFm, ...noteFm }).catch((err) => {
        console.error(`Failed to apply template properties to ${path}:`, err)
      })
    }
    const add = parseBlocks(body).blocks
    const next = cloneBlocks(blocks)
    const idx = indexOfBlock(next, id)
    if (idx < 0) return
    if (!add.length) {
      next[idx] = { ...next[idx], text: '' }
      pendingCaret.current = { id, pos: 'start' }
    } else {
      next.splice(idx, 1, ...add)
      const last = add[add.length - 1]
      pendingCaret.current = { id: last.id, pos: 'end' }
      setEditingId(last.id)
    }
    commit(next)
  }

  const onChange = (b: Block, e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    autoGrow(e.target)
    // `/` opens the slash command menu (Insert template, headings, table, …).
    // The block text stays `/<query>`; selecting a command acts on this block.
    if (b.type === 'paragraph' && /^\/\w*$/.test(value)) {
      const q = value.slice(1)
      setText(b.id, value)
      setAc((prev) =>
        prev && prev.id === b.id && prev.kind !== 'link'
          ? { ...prev, query: q, index: 0 }
          : { id: b.id, query: q, index: 0, kind: 'slash-menu' }
      )
      return
    }
    if (b.type === 'paragraph') {
      const sc = detectShortcut(value)
      if (sc) {
        patchById(b.id, { ...sc.patch, text: value.slice(sc.strip) }, 0)
        setAc(null)
        return
      }
    }
    // Inside a bullet, typing `[ ] ` / `[x] ` turns it into a task (the outline
    // already ate the leading `- `, so detectShortcut never sees it).
    if (b.type === 'bullet') {
      const tm = value.match(/^\[([ xX]?)\]\s/)
      if (tm) {
        patchById(b.id, { type: 'task', checked: tm[1].toLowerCase() === 'x', text: value.slice(tm[0].length) }, 0)
        setAc(null)
        return
      }
    }
    // Supertag auto-entity: typing `<name> #<supertag> ` turns <name> into a typed
    // entity — create/link its note, apply the tag, and leave a [[wikilink]] behind
    // (the tag's meaning now lives on the entity, not in this line).
    if (b.type !== 'code') {
      const caret = e.target.selectionStart
      const upto = value.slice(0, caret)
      const m = upto.match(/(^|\s)(\[\[[^\]\n]+\]\]|[^\s#]+)[ \t]+#([\p{L}\d][\p{L}\d_/-]*)[ \t]$/u)
      if (m && supertagIndex.has(normTag(m[3]))) {
        const entityName = m[2].replace(/^\[\[|\]\]$/g, '').trim()
        if (entityName) {
          const head = upto.slice(0, (m.index ?? 0) + m[1].length)
          const newUpto = `${head}[[${entityName}]] `
          pendingCaret.current = { id: b.id, pos: newUpto.length }
          replaceText(b.id, newUpto + value.slice(caret))
          setAc(null)
          void ensureEntity(entityName, m[3])
          return
        }
      }
    }
    // Undo granularity: start a new step when switching insert↔delete, and end the
    // step after a whitespace (so each word is undoable on its own).
    const op = value.length > b.text.length ? 'ins' : value.length < b.text.length ? 'del' : 'rep'
    if (op !== lastOp.current) coalesceGen.current++
    lastOp.current = op === 'rep' ? lastOp.current : op
    setText(b.id, value)
    if (op === 'ins' && /\s/.test(value[e.target.selectionStart - 1] ?? '')) coalesceGen.current++
    const upto = value.slice(0, e.target.selectionStart)
    const wl = upto.match(/\[\[([^\]\n]*)$/)
    setAc(wl ? { id: b.id, query: wl[1], index: 0, kind: 'link' } : null)
  }

  const onKeyDown = (b: Block, e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    const pos = ta.selectionStart
    const val = ta.value
    const mod = e.metaKey || e.ctrlKey

    // ⌘⇧V — paste as-is: flag the upcoming paste to skip markdown→block parsing, then
    // let the native paste run (a textarea pastes plain text, so the result is verbatim).
    if (mod && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      plainPasteRef.current = true
      return
    }

    // Highlight a phrase + `#` → open the supertag picker for that selection.
    // Only when supertags exist — otherwise let the `#` type normally.
    if (e.key === '#' && ta.selectionStart !== ta.selectionEnd && b.type !== 'code' && !mod && supertagIndex.size > 0) {
      e.preventDefault()
      const raw = val.slice(ta.selectionStart, ta.selectionEnd)
      const start = ta.selectionStart + (raw.length - raw.trimStart().length)
      const end = ta.selectionEnd - (raw.length - raw.trimEnd().length)
      const name = val.slice(start, end)
      if (name) {
        const r = ta.getBoundingClientRect()
        setTagPick({ id: b.id, start, end, text: val, name, x: r.left + 28, y: r.bottom, query: '', index: 0 })
      }
      return
    }

    if (ac && ac.id === b.id) {
      const list = acList
      if (list.length) {
        if (e.key === 'ArrowDown') return e.preventDefault(), setAc({ ...ac, index: (ac.index + 1) % list.length })
        if (e.key === 'ArrowUp') return e.preventDefault(), setAc({ ...ac, index: (ac.index - 1 + list.length) % list.length })
        if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), applyItem(b.id, list[ac.index])
        if (e.key === 'Escape') return e.preventDefault(), setAc(null)
      }
    }

    // Stamp the current video play time (⌘/Ctrl+;) at the caret.
    if (mod && e.key === ';') return e.preventDefault(), insertTimestamp()

    // Find & replace (⌘F open, ⌘G / ⇧⌘G step through matches).
    if (mod && (e.key === 'f' || e.key === 'F')) return e.preventDefault(), openFind()
    if (mod && (e.key === 'g' || e.key === 'G'))
      return e.preventDefault(), void (matches.length && gotoMatch((find?.idx ?? -1) + (e.shiftKey ? -1 : 1)))

    // Undo / redo (block-level history).
    if (mod && (e.key === 'z' || e.key === 'Z')) return e.preventDefault(), void (e.shiftKey ? redo() : undo())
    if (mod && e.key === 'y') return e.preventDefault(), redo()

    // ⌘A ladder: first press selects this block's text; second (text already fully
    // selected, or empty) selects the block + its subtree; a third press — now in
    // selection mode — falls to the container handler, which selects the whole view.
    if (mod && (e.key === 'a' || e.key === 'A')) {
      const wholeBlock = val.length === 0 || (ta.selectionStart === 0 && ta.selectionEnd === val.length)
      if (wholeBlock) {
        e.preventDefault()
        setEditingId(null)
        window.getSelection()?.removeAllRanges()
        anchorRef.current = b.id
        const idx = indexOfBlock(blocks, b.id)
        const [s, en] = childrenRange(blocks, idx)
        const sub = new Set([b.id, ...blocks.slice(s, en).map((x) => x.id)])
        setSelIds(new Set(visibleBlocks(blocks).filter((v) => sub.has(v.block.id)).map((v) => v.block.id)))
        outlinerRef.current?.focus()
      }
      return // otherwise let the native textarea select-all (this block) run
    }

    // Escape: leave editing and select this whole bullet.
    if (e.key === 'Escape') {
      e.preventDefault()
      anchorRef.current = b.id
      setEditingId(null)
      window.getSelection()?.removeAllRanges()
      setSelIds(new Set([b.id]))
      outlinerRef.current?.focus()
      return
    }

    // Code and table blocks: Enter inserts a newline.
    if (b.type === 'code' || b.type === 'table') {
      if (mod && e.key === '.') {
        e.preventDefault()
        toggleCollapse(b.id)
      }
      return
    }

    // Bold / italic: wrap the selection (or insert empty markers).
    if (mod && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault()
      const marker = e.key === 'b' ? '**' : '_'
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const sel = val.slice(start, end)
      pendingCaret.current = { id: b.id, pos: sel ? end + marker.length * 2 : start + marker.length }
      replaceText(b.id, val.slice(0, start) + marker + sel + marker + val.slice(end))
      return
    }

    // Type a bracket/quote with text selected → wrap it instead of replacing. Press
    // again to nest (e.g. select a word, press [ twice → [[word]]); the word stays selected.
    if (WRAP_PAIRS[e.key] && ta.selectionStart !== ta.selectionEnd) {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const inner = val.slice(start, end)
      pendingCaret.current = { id: b.id, pos: start + 1, end: end + 1 }
      replaceText(b.id, val.slice(0, start) + e.key + inner + WRAP_PAIRS[e.key] + val.slice(end))
      return
    }

    // Cmd/Ctrl+Enter cycles the line: text → ☐ → ☑ → text (no bullet).
    if (mod && e.key === 'Enter') {
      e.preventDefault()
      if (b.type === 'task') {
        if (!b.checked) patchById(b.id, { checked: true }, pos)
        else patchById(b.id, { type: 'paragraph', checked: undefined, ordered: undefined }, pos)
      } else if (b.type !== 'heading') {
        patchById(b.id, { type: 'task', checked: false, ordered: undefined }, pos)
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isList(b) && b.text === '') {
        const minLvl = zoomMinLevel()
        // Empty list item + Enter normally exits the list (outdent, or un-list at level 0).
        // Inside a zoom, the root's direct children are the top level: don't outdent past
        // it (that escapes the zoom) and don't un-list it (a paragraph isn't a descendant
        // either) — just keep the empty bullet so the line stays put and in view.
        if (b.level > Math.max(0, minLvl)) outdent(b.id, 0)
        else if (minLvl === 0) patchById(b.id, { type: 'paragraph', ordered: undefined, checked: undefined }, 0)
        return
      }
      // ```lang on its own line + Enter → a code block tagged with that language.
      const fence = b.type === 'paragraph' && val.match(/^```([\w+#.-]*)$/)
      if (fence) {
        patchById(b.id, { type: 'code', lang: fence[1], text: '' }, 0)
        return
      }
      insertAfter(b.id, val.slice(0, pos), val.slice(pos))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (isList(b)) (e.shiftKey ? outdent : indent)(b.id, pos)
    } else if (e.key === 'Backspace' && pos === 0 && ta.selectionEnd === 0) {
      e.preventDefault()
      mergeUp(b.id)
    } else if (mod && e.shiftKey && e.key === 'ArrowUp') {
      e.preventDefault()
      move(b.id, -1, pos)
    } else if (mod && e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault()
      move(b.id, 1, pos)
    } else if (mod && e.key === '.') {
      e.preventDefault()
      toggleCollapse(b.id)
    } else if (mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      foldAllInView(e.key === 'ArrowUp') // ⌥⌘↑ collapse all / ⌥⌘↓ expand all (view-scoped)
    } else if (mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Logseq: ⌘↑ collapses, ⌘↓ expands (directional, so each is idempotent).
      // Falls through to the native caret jump when there is nothing to fold.
      const idx = indexOfBlock(blocks, b.id)
      const canFold = idx >= 0 && foldableAt(blocks, idx)
      if (canFold && (e.key === 'ArrowUp' ? !b.collapsed : b.collapsed)) {
        e.preventDefault()
        toggleCollapse(b.id)
      }
    } else if (!mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Logseq: ⌥↑ / ⌥↓ select the current bullet and extend up/down.
      e.preventDefault()
      startBlockSelection(b.id, e.key === 'ArrowUp' ? -1 : 1)
    } else if (!mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Move by *visual* line within a wrapped/multiline block; only cross into the
      // adjacent block from the true top/bottom row. Mid-block presses fall through to
      // the textarea's native caret movement (so wrapped long lines step row by row).
      const up = e.key === 'ArrowUp'
      const { atFirst, atLast } = caretLine(ta)
      if (!(up ? atFirst : atLast)) return
      e.preventDefault()
      if (e.shiftKey) startBlockSelection(b.id, up ? -1 : 1)
      else focusAdjacent(b.id, up ? -1 : 1, up ? 'end' : 'start')
    }
  }

  // Drag-resize on a rendered image: rewrite its `![alt|width](src)` markdown in place.
  const resizeImage = (blockId: number, src: string, width: number): void => {
    const blk = blocksRef.current.find((b) => b.id === blockId)
    if (!blk) return
    const re = new RegExp(`!\\[([^\\]\\n]*)\\]\\(${escapeRegExp(src)}\\)`)
    const next = blk.text.replace(re, (_m, alt: string) => {
      const parts = String(alt).split('|')
      const isNum = (s?: string): boolean => !!s && /^\d+$/.test(s.trim())
      // Alt can be "300", "label", or "label|300" — keep the label, replace the width.
      const label = isNum(parts[0]) ? (parts[1] ?? '') : (parts[0] ?? '')
      return label.trim() ? `![${label}|${width}](${src})` : `![${width}](${src})`
    })
    if (next !== blk.text) replaceText(blockId, next)
  }

  // ---- rendering ----
  const inlineOf = (s: string, blockId?: number): React.ReactNode[] =>
    renderInline(s, {
      isResolved,
      onNavigate: navigate,
      onTag: openTag,
      supertagOf,
      onExpandEntity: expandEntity,
      spellcheck: true,
      onMisspelling:
        blockId != null ? (word, x, y) => openSpellMenu(blockId, word, x, y) : undefined,
      onImageResize: blockId != null ? (src, w) => resizeImage(blockId, src, w) : undefined
    })

  // The find match currently being cycled to (for in-place highlighting).
  const activeMatch = find && find.idx >= 0 && find.idx < matches.length ? matches[find.idx] : null

  // Render a block's text with the active find match wrapped in <mark>, keeping inline
  // markdown around it. Used for plain-text blocks (callers skip code/table).
  const renderHighlighted = (b: Block, m: FindMatch): React.ReactNode => (
    <>
      {inlineOf(b.text.slice(0, m.start), b.id)}
      <mark className="find-hit">{b.text.slice(m.start, m.end)}</mark>
      {inlineOf(b.text.slice(m.end), b.id)}
    </>
  )

  const renderRich = (b: Block, tableWidths?: number[]): React.ReactNode => {
    // `{{query ...}}` renders a live list of matching blocks.
    const queryM = b.type !== 'code' && b.text.match(/^\{\{query\s+([^}]+)\}\}\s*$/i)
    if (queryM) return <QueryView raw={queryM[1].trim()} />
    const baseM = b.type !== 'code' && b.text.match(/^\{\{base\s+([^}]+)\}\}\s*$/i)
    if (baseM) return <BaseEmbed raw={baseM[1].trim()} />
    // A block that's just a video URL (or `{{video <url>}}`) renders an in-app player.
    if (b.type !== 'code' && b.type !== 'table') {
      const t = b.text.trim()
      const vm = t.match(/^\{\{video\s+(\S+)\}\}$/i)
      const vurl = vm ? vm[1] : /^https?:\/\/\S+$/.test(t) ? t : null
      const video = vurl ? parseVideoUrl(vurl) : null
      if (video) return <VideoEmbed video={video} onAddTimestamp={(k, s) => addVideoTimestamp(b.id, k, s)} />
    }
    if (b.type === 'code') {
      return <CodeBlock text={b.text} lang={b.lang} />
    }
    if (b.type === 'table') {
      const { header, rows } = parseTable(b.text)
      const w = tableWidths
      return (
        <table className={'bl-table' + (w ? ' bl-table-fixed' : '')}>
          {w && (
            <colgroup>
              {header.map((_, i) => (
                <col key={i} style={w[i] != null ? { width: w[i] + 'px' } : undefined} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i}>{inlineOf(h, b.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{inlineOf(c, b.id)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    // `---` / `***` / `___` on its own line → a horizontal rule.
    if (b.type === 'paragraph' && /^\s*([-*_])\1{2,}\s*$/.test(b.text)) return <hr className="bl-hr" />
    if (b.text.trim() === '') return <span className="ol-placeholder">&nbsp;</span>
    const body = b.text.split('\n').map((line, i) => (
      <span key={i}>
        {i > 0 && <br />}
        {inlineOf(line, b.id)}
      </span>
    ))
    if (b.type === 'task') {
      return <span className={b.checked ? 'ol-done' : ''}>{body}</span>
    }
    return body
  }

  const editing = (b: Block, mono = false): React.JSX.Element => {
    const ta = (
    <textarea
      className={mono ? 'ol-input bl-code-input code-live' : 'ol-input'}
      rows={1}
      value={b.text}
      ref={(el) => {
        if (el) {
          taRefs.current.set(b.id, el)
          autoGrow(el)
        } else taRefs.current.delete(b.id)
      }}
      onChange={(e) => onChange(b, e)}
      onKeyDown={(e) => onKeyDown(b, e)}
      onMouseDown={() => {
        // Anchor a possible drag-out-to-multi-select from inside the field.
        dragRef.current = { anchor: b.id }
        anchorRef.current = b.id
      }}
      onPaste={(e) => {
        const fs = e.clipboardData?.files
        if (fs && fs.length) {
          e.preventDefault()
          void handleFiles(fs, b.id)
          return
        }
        // ⌘⇧V (paste-as-is): insert the clipboard text verbatim — no block parsing.
        if (plainPasteRef.current) {
          plainPasteRef.current = false
          return
        }
        if (tryPasteBlocks(e, b.id)) return e.preventDefault()
        const text = e.clipboardData?.getData('text/plain') ?? ''
        // A bare (non-video) URL pasted on its own → fetch its title in the background.
        const u = text.trim()
        if (/^https?:\/\/\S+$/.test(u) && !parseVideoUrl(u)) smartTitlePaste(b.id, u)
        if (b.type !== 'code' && b.type !== 'table' && pasteText(b, e.currentTarget, text)) e.preventDefault()
      }}
      onBlur={() => setTimeout(() => setAc(null), 120)}
    />
    )
    // Code blocks get a live-highlight layer painted underneath the (transparent-text)
    // textarea, so syntax colours show while editing.
    return mono ? (
      <div className="code-edit-wrap">
        <CodeHighlightLayer text={b.text} lang={b.lang} />
        {ta}
      </div>
    ) : (
      ta
    )
  }

  // Tables are keyed for width-persistence by their ordinal among table blocks (stable across
  // edits to non-table blocks), stored in the note's `_tableWidths` frontmatter.
  const tableOrdinal = (index: number): number =>
    blocks.slice(0, index).filter((x) => x.type === 'table').length
  const tableWidthsFor = (index: number): number[] | undefined => {
    const fm = parseFrontmatter(useStore.getState().texts[path] ?? '').data as {
      _tableWidths?: Record<string, number[]>
    }
    return fm._tableWidths?.[tableOrdinal(index)]
  }

  /** Zoom into a list item (bullet/number click) and start editing it. */
  const zoomInto = (id: number): void => {
    setZoomId(id)
    setEditingId(id)
  }

  /** The editing surface for a block: TableEditor for tables, the textarea otherwise. */
  const renderEditing = (b: Block, index: number): React.JSX.Element =>
    b.type === 'table' ? (
      <TableEditor
        text={b.text}
        widths={tableWidthsFor(index)}
        onChange={(md) => setText(b.id, md)}
        onWidths={(w) => void useStore.getState().setTableWidths(path, tableOrdinal(index), w)}
        onExit={() => setEditingId(null)}
      />
    ) : (
      editing(b, b.type === 'code')
    )

  // The memoized rows call the latest closures through this ref (stable identity),
  // so a keystroke re-renders only the edited row — see BlockRow.
  const rowApi = useRef<RowApi>({} as RowApi)
  rowApi.current = {
    onRowMouseDown,
    onHandleMouseDown,
    toggleCollapse,
    toggleTask,
    // A drag-reorder ends with a click on the handle — swallow it so it doesn't zoom.
    zoomInto: (id) => {
      if (justDraggedRef.current) return
      zoomInto(id)
    },
    applyItem,
    renderRich,
    renderHighlighted,
    renderEditing,
    acKind: () => ac?.kind ?? null
  }

  // Bumped when vault-wide data changes so cached rows refresh link resolution,
  // entity chips, and spell squiggles; typing in one block leaves the rest cached.
  const dataTickRef = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dataTick = useMemo(() => ++dataTickRef.current, [parsed, files, index, spellTick])

  // Zoom: restrict to a block + its section, rebasing indent. Memoized because
  // visibleBlocks() is an O(n) scan and this sits in the per-keystroke render path.
  const { rows, crumbs, zoomIdx } = useMemo(() => {
    const zoomIdx = zoomId != null ? indexOfBlock(blocks, zoomId) : -1
    let rows = visibleBlocks(blocks)
    const crumbs: Block[] = []
    if (zoomIdx >= 0) {
      const [s, e] = childrenRange(blocks, zoomIdx)
      const base = isList(blocks[zoomIdx]) ? blocks[zoomIdx].level : 0
      rows = rows
        .filter((r) => r.index === zoomIdx || (r.index >= s && r.index < e))
        .map((r) => ({ ...r, depth: Math.max(0, r.depth - base) }))
      let lvl = base
      for (let k = zoomIdx - 1; k >= 0; k--) {
        const bk = blocks[k]
        if (bk.type === 'heading') {
          crumbs.unshift(bk)
          break
        }
        if (isList(bk) && bk.level < lvl) {
          crumbs.unshift(bk)
          lvl = bk.level
        }
      }
    }
    return { rows, crumbs, zoomIdx }
  }, [blocks, zoomId])

  return (
    <div
      className="outliner"
      ref={outlinerRef}
      tabIndex={-1}
      onKeyDown={onContainerKeyDown}
      onPaste={(e) => {
        if (editingId !== null) return // the focused textarea handles its own paste
        const idxs = selectedIndices()
        const afterId = idxs.length ? blocks[idxs[idxs.length - 1]].id : (blocks[blocks.length - 1]?.id ?? -1)
        if (tryPasteBlocks(e, afterId)) return e.preventDefault()
        // No field focused: parse the pasted markdown into real blocks.
        const text = e.clipboardData?.getData('text/plain') ?? ''
        const parsed = parseBlocks(text).blocks
        if (parsed.length) {
          e.preventDefault()
          pasteBlocks(afterId, parsed)
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          void handleFiles(e.dataTransfer.files, editingId ?? blocks[blocks.length - 1]?.id ?? -1)
        }
      }}
    >
      {find && (
        <div className="find-bar" style={barStyle} onKeyDown={onFindKeyDown}>
          <input
            ref={findInputRef}
            className="find-input"
            placeholder="Find"
            value={find.q}
            onChange={(e) => setFind({ ...find, q: e.target.value, idx: -1 })}
          />
          <span className="find-count">
            {find.q ? `${find.idx >= 0 ? find.idx + 1 : 0}/${matches.length}` : ''}
          </span>
          <button
            className="find-btn"
            title="Previous match (⇧⌘G)"
            disabled={!matches.length}
            onClick={() => gotoMatch((find.idx ?? -1) - 1)}
          >
            ↑
          </button>
          <button
            className="find-btn"
            title="Next match (⌘G)"
            disabled={!matches.length}
            onClick={() => gotoMatch((find.idx ?? -1) + 1)}
          >
            ↓
          </button>
          <input
            className="find-input find-replace"
            placeholder="Replace"
            value={find.r}
            onChange={(e) => setFind({ ...find, r: e.target.value })}
          />
          <button className="find-btn find-text" title="Replace this match" disabled={!matches.length} onClick={replaceCurrent}>
            Replace
          </button>
          <button className="find-btn find-text" title="Replace all in note" disabled={!matches.length} onClick={replaceAll}>
            All
          </button>
          <button className="find-btn find-close" title="Close (Esc)" onClick={() => closeFind()}>
            ×
          </button>
        </div>
      )}
      {zoomIdx >= 0 && (
        <div className="ol-breadcrumb">
          <span onClick={() => setZoomId(null)}>⌂ Home</span>
          {crumbs.map((c) => (
            <span key={c.id} onClick={() => setZoomId(c.id)}>
              {' / '}
              {c.text.replace(/^#{1,6}\s+/, '').slice(0, 30) || 'untitled'}
            </span>
          ))}
        </div>
      )}
      {rows.map((r) => (
        <BlockRow
          key={r.block.id}
          b={r.block}
          index={r.index}
          depth={r.depth}
          foldable={foldableAt(blocks, r.index)}
          selected={selIds.has(r.block.id)}
          isEditing={editingId === r.block.id}
          orderedLbl={r.block.type === 'bullet' && r.block.ordered ? orderedLabel(blocks, r.index) : null}
          tableWidths={r.block.type === 'table' ? tableWidthsFor(r.index) : undefined}
          acList={ac && ac.id === r.block.id ? acList : null}
          acIndex={ac && ac.id === r.block.id ? ac.index : 0}
          activeMatch={activeMatch && activeMatch.id === r.block.id ? activeMatch : null}
          dataTick={dataTick}
          api={rowApi}
        />
      ))}
      <div className="ol-tail" onMouseDown={onTailMouseDown} title="Click to write" />
      {dropHint && (
        <div
          className="ol-drop-line"
          style={{ top: dropHint.top, left: dropHint.left, width: dropHint.width }}
        />
      )}
      {entityPop && (
        <>
          <div className="entity-pop-backdrop" onMouseDown={() => setEntityPop(null)} />
          <div className="entity-pop" style={{ left: entityPop.x, top: entityPop.y + 6 }}>
            <EntityCard path={entityPop.path} onClose={() => setEntityPop(null)} />
          </div>
        </>
      )}
      {spellMenu && (
        <ContextMenu
          x={spellMenu.x}
          y={spellMenu.y}
          onClose={() => setSpellMenu(null)}
          items={[
            ...spellMenu.suggestions.map((s) => ({
              label: s,
              onClick: () => applySpellFix(spellMenu.blockId, spellMenu.word, s)
            })),
            ...(spellMenu.suggestions.length ? [] : [{ label: 'No suggestions', onClick: () => {} }]),
            { label: `Add “${spellMenu.word}” to dictionary`, onClick: () => ignoreSpellWord(spellMenu.word) }
          ]}
        />
      )}
      {tagPick &&
        (() => {
          const items = [...supertagIndex.values()].filter((s) =>
            s.name.toLowerCase().includes(tagPick.query.toLowerCase())
          )
          const idx = Math.min(tagPick.index, Math.max(0, items.length - 1))
          return (
            <>
              <div className="entity-pop-backdrop" onMouseDown={() => setTagPick(null)} />
              <div
                className="tagpick"
                style={{ left: tagPick.x, top: tagPick.y + 4 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="tagpick-head">
                  Tag “{tagPick.name}” as…
                </div>
                <input
                  className="tagpick-input"
                  autoFocus
                  placeholder="supertag…"
                  value={tagPick.query}
                  onChange={(e) => setTagPick({ ...tagPick, query: e.target.value, index: 0 })}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setTagPick({ ...tagPick, index: Math.min(idx + 1, items.length - 1) })
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setTagPick({ ...tagPick, index: Math.max(0, idx - 1) })
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      if (items[idx]) applyTagPick(items[idx].name)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setTagPick(null)
                    }
                  }}
                />
                <div className="tagpick-list">
                  {items.length === 0 && (
                    <div className="tagpick-empty">No matching supertag — create one on the Tags page.</div>
                  )}
                  {items.map((s, i) => (
                    <div
                      key={s.tag}
                      className={'tagpick-item' + (i === idx ? ' sel' : '')}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        applyTagPick(s.name)
                      }}
                    >
                      <span className="tagpick-avatar" style={{ background: tagAvatarColor(s.name) }}>
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="tagpick-name">#{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )
        })()}
    </div>
  )
}
