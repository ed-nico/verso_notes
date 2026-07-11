import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { renderInline } from './InlineMarkdown'
import { openLinkTarget } from '../lib/openLink'
import { resolveTarget } from '../lib/links'
import { ContextMenu, type MenuItem } from './ContextMenu'
import {
  defaultSize,
  edgeEnds,
  edgePath,
  emptyDoc,
  fileNodeName,
  fitTransform,
  genId,
  nodeRect,
  nodesBounds,
  normalizeDoc,
  NOTE_DND_MIME,
  pointInRect,
  PRESET_COLORS,
  rectsIntersect,
  resolveColor,
  screenToWorld,
  sideAnchor,
  SIDES,
  worldToScreen,
  zoomAt,
  type CanvasDoc,
  type CanvasNode,
  type Side,
  type Transform
} from '../lib/canvas'

const GRID = 24 // background dot spacing in world px
const DRAG_THRESHOLD = 4 // px of movement before a pointer-press becomes a drag

function cssTransform(t: Transform): string {
  return `translate(${t.tx}px, ${t.ty}px) scale(${t.zoom})`
}

// Link-card titles are fetched once and cached process-wide so re-renders don't re-fetch.
const titleCache = new Map<string, string>()

export function CanvasView(): React.JSX.Element {
  const activeCanvasPath = useStore((s) => s.activeCanvasPath)
  const createCanvas = useStore((s) => s.createCanvas)
  if (!activeCanvasPath) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty-inner">
          <div className="canvas-empty-mark">▱</div>
          <h2>Canvas</h2>
          <p>An infinite space to arrange notes, ideas, and links — and connect them.</p>
          <button className="btn" onClick={() => void createCanvas('Canvas')}>
            ＋ Create a canvas
          </button>
        </div>
      </div>
    )
  }
  // Keyed by path so switching canvases fully remounts with the new file's content.
  return <CanvasSurface key={activeCanvasPath} path={activeCanvasPath} />
}

interface Selection {
  nodes: Set<string>
  edges: Set<string>
}
const emptySelection = (): Selection => ({ nodes: new Set(), edges: new Set() })

/** A linking gesture in flight: dragging a new edge out of a node's side port. */
interface Linking {
  fromNode: string
  fromSide: Side
  to: { x: number; y: number } // world point under the cursor
  overNode: string | null
}

function CanvasSurface({ path }: { path: string }): React.JSX.Element {
  const files = useStore((s) => s.files)
  const index = useStore((s) => s.index)
  const navigate = useStore((s) => s.navigate)
  const openNote = useStore((s) => s.openNote)
  const canvasName = useStore((s) => s.canvases.find((c) => c.path === path)?.name ?? 'Canvas')
  const renameCanvas = useStore((s) => s.renameCanvas)
  const deleteCanvas = useStore((s) => s.deleteCanvas)

  const [doc, setDoc] = useState<CanvasDoc>(emptyDoc)
  const [loaded, setLoaded] = useState(false)
  const [transform, setTransformState] = useState<Transform>({ tx: 0, ty: 0, zoom: 1 })
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [linking, setLinking] = useState<Linking | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const transformRef = useRef(transform)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const undoStack = useRef<CanvasDoc[]>([])
  const redoStack = useRef<CanvasDoc[]>([])
  const dirtyRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- transform (kept in a ref for synchronous reads during wheel/pan bursts) ----
  const setT = useCallback((t: Transform): void => {
    transformRef.current = t
    setTransformState(t)
  }, [])

  // ---- load + persist ----
  useEffect(() => {
    let alive = true
    void window.verso.readCanvas(path).then((raw) => {
      if (!alive) return
      const d = normalizeDoc(raw)
      setDoc(d)
      docRef.current = d
      setLoaded(true)
      // Fit the content (or sit at origin for a blank canvas) once we know the size.
      const el = containerRef.current
      const b = nodesBounds(d.nodes)
      if (el && b) setT(fitTransform(b, el.clientWidth, el.clientHeight))
    })
    return () => {
      alive = false
    }
  }, [path, setT])

  const flush = useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!dirtyRef.current) return
    dirtyRef.current = false
    void window.verso.writeCanvas(path, docRef.current)
  }, [path])

  const markDirty = useCallback((): void => {
    dirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 500)
  }, [flush])

  // Flush on unmount (view switch / canvas switch) and when the window is hidden/closing.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  // ---- doc mutation + undo ----
  /** Apply an immediate, discrete edit (snapshots the prior doc for undo). */
  const mutate = useCallback(
    (producer: (d: CanvasDoc) => CanvasDoc): void => {
      const before = docRef.current
      const next = producer(before)
      if (next === before) return
      undoStack.current.push(before)
      if (undoStack.current.length > 100) undoStack.current.shift()
      redoStack.current = []
      docRef.current = next
      setDoc(next)
      markDirty()
    },
    [markDirty]
  )
  /** Commit a continuous gesture (drag/resize) whose intermediate frames skipped undo. */
  const commitGesture = useCallback(
    (before: CanvasDoc): void => {
      undoStack.current.push(before)
      if (undoStack.current.length > 100) undoStack.current.shift()
      redoStack.current = []
      markDirty()
    },
    [markDirty]
  )
  const undo = useCallback((): void => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(docRef.current)
    docRef.current = prev
    setDoc(prev)
    markDirty()
  }, [markDirty])
  const redo = useCallback((): void => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(docRef.current)
    docRef.current = next
    setDoc(next)
    markDirty()
  }, [markDirty])

  // ---- coordinate helpers ----
  const containerPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = containerRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }, [])
  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } =>
      screenToWorld(containerPoint(e), transformRef.current),
    [containerPoint]
  )

  // ---- node creation ----
  const addNode = useCallback(
    (node: CanvasNode, opts?: { edit?: boolean; select?: boolean }): void => {
      mutate((d) => ({ ...d, nodes: [...d.nodes, node] }))
      if (opts?.select !== false) setSelection({ nodes: new Set([node.id]), edges: new Set() })
      if (opts?.edit) setEditingId(node.id)
    },
    [mutate]
  )
  /** Centre of the current viewport in world coordinates (where toolbar-added nodes land). */
  const viewportCenter = useCallback((): { x: number; y: number } => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    return screenToWorld({ x: el.clientWidth / 2, y: el.clientHeight / 2 }, transformRef.current)
  }, [])
  const newTextNode = useCallback(
    (at: { x: number; y: number }, edit = true): void => {
      const { width, height } = defaultSize('text')
      addNode({ id: genId(), type: 'text', text: '', x: at.x - width / 2, y: at.y - height / 2, width, height }, { edit })
    },
    [addNode]
  )
  const newLinkNode = useCallback(
    (at: { x: number; y: number }, url = ''): void => {
      const { width, height } = defaultSize('link')
      addNode(
        { id: genId(), type: 'link', url, x: at.x - width / 2, y: at.y - height / 2, width, height },
        { edit: !url }
      )
    },
    [addNode]
  )
  const newFileNode = useCallback(
    (at: { x: number; y: number }, file: string): void => {
      const { width, height } = defaultSize('file')
      addNode({ id: genId(), type: 'file', file, x: at.x - width / 2, y: at.y - height / 2, width, height })
    },
    [addNode]
  )

  // ---- selection-wide ops ----
  const deleteSelection = useCallback((): void => {
    const sel = selectionRef.current
    if (!sel.nodes.size && !sel.edges.size) return
    mutate((d) => ({
      nodes: d.nodes.filter((n) => !sel.nodes.has(n.id)),
      // Drop edges that are selected, or attached to a deleted node.
      edges: d.edges.filter(
        (e) => !sel.edges.has(e.id) && !sel.nodes.has(e.fromNode) && !sel.nodes.has(e.toNode)
      )
    }))
    setSelection(emptySelection())
  }, [mutate])

  const duplicateSelection = useCallback((): void => {
    const sel = selectionRef.current
    if (!sel.nodes.size) return
    const idMap = new Map<string, string>()
    const clones: CanvasNode[] = []
    for (const n of docRef.current.nodes) {
      if (!sel.nodes.has(n.id)) continue
      const nid = genId()
      idMap.set(n.id, nid)
      clones.push({ ...n, id: nid, x: n.x + 40, y: n.y + 40 })
    }
    if (!clones.length) return
    const newEdges = docRef.current.edges
      .filter((e) => idMap.has(e.fromNode) && idMap.has(e.toNode))
      .map((e) => ({ ...e, id: genId(), fromNode: idMap.get(e.fromNode)!, toNode: idMap.get(e.toNode)! }))
    mutate((d) => ({ nodes: [...d.nodes, ...clones], edges: [...d.edges, ...newEdges] }))
    setSelection({ nodes: new Set(idMap.values()), edges: new Set() })
  }, [mutate])

  const setSelectionColor = useCallback(
    (color: string | undefined): void => {
      const sel = selectionRef.current
      if (!sel.nodes.size && !sel.edges.size) return
      mutate((d) => ({
        nodes: d.nodes.map((n) => (sel.nodes.has(n.id) ? { ...n, color } : n)),
        edges: d.edges.map((e) => (sel.edges.has(e.id) ? { ...e, color } : e))
      }))
    },
    [mutate]
  )

  // ---- view ops ----
  const zoomTo = useCallback(
    (factor: number): void => {
      const el = containerRef.current
      const center = el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 0, y: 0 }
      setT(zoomAt(transformRef.current, transformRef.current.zoom * factor, center))
    },
    [setT]
  )
  const zoomToFit = useCallback((): void => {
    const el = containerRef.current
    const b = nodesBounds(docRef.current.nodes)
    if (el && b) setT(fitTransform(b, el.clientWidth, el.clientHeight))
  }, [setT])
  const resetZoom = useCallback((): void => {
    const el = containerRef.current
    if (el) setT(zoomAt(transformRef.current, 1, { x: el.clientWidth / 2, y: el.clientHeight / 2 }))
  }, [setT])

  // ---- wheel: pinch / ⌘-wheel zooms; otherwise pans ----
  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      e.preventDefault()
      const t = transformRef.current
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01)
        setT(zoomAt(t, t.zoom * factor, containerPoint(e)))
      } else {
        setT({ ...t, tx: t.tx - e.deltaX, ty: t.ty - e.deltaY })
      }
    },
    [containerPoint, setT]
  )

  // ---- background pointer-down: pan (space/middle) or marquee-select ----
  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      if (e.button === 2) return // right-click → context handled elsewhere
      setMenu(null)
      const startScreen = containerPoint(e)
      const panning = spaceDown || e.button === 1
      const startT = transformRef.current
      let moved = false

      if (panning) {
        const onMove = (ev: PointerEvent): void => {
          const p = containerPoint(ev)
          setT({ ...startT, tx: startT.tx + (p.x - startScreen.x), ty: startT.ty + (p.y - startScreen.y) })
        }
        const onUp = (): void => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }

      // Marquee selection. Holding shift adds to the existing selection.
      const additive = e.shiftKey
      const base = additive ? new Set(selectionRef.current.nodes) : new Set<string>()
      if (!additive) setSelection(emptySelection())
      // NB: don't clear editingId here — that would unmount an editing textarea before its
      // onBlur fires, losing the commit. The mousedown naturally blurs it, which commits.
      const onMove = (ev: PointerEvent): void => {
        const p = containerPoint(ev)
        if (!moved && Math.hypot(p.x - startScreen.x, p.y - startScreen.y) < DRAG_THRESHOLD) return
        moved = true
        const rect = {
          x: Math.min(startScreen.x, p.x),
          y: Math.min(startScreen.y, p.y),
          w: Math.abs(p.x - startScreen.x),
          h: Math.abs(p.y - startScreen.y)
        }
        setMarquee(rect)
        // Convert the screen marquee to world space and hit-test node rects.
        const a = screenToWorld({ x: rect.x, y: rect.y }, transformRef.current)
        const worldRect = { x: a.x, y: a.y, width: rect.w / transformRef.current.zoom, height: rect.h / transformRef.current.zoom }
        const hit = new Set(base)
        for (const n of docRef.current.nodes) if (rectsIntersect(worldRect, nodeRect(n))) hit.add(n.id)
        setSelection({ nodes: hit, edges: new Set() })
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setMarquee(null)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [containerPoint, setT, spaceDown]
  )

  // ---- node drag ----
  const onNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string): void => {
      if (e.button !== 0) return
      e.stopPropagation()
      setMenu(null)
      const sel = selectionRef.current
      let nextNodes: Set<string>
      if (e.shiftKey) {
        nextNodes = new Set(sel.nodes)
        nextNodes.has(nodeId) ? nextNodes.delete(nodeId) : nextNodes.add(nodeId)
      } else if (sel.nodes.has(nodeId)) {
        nextNodes = sel.nodes
      } else {
        nextNodes = new Set([nodeId])
      }
      setSelection({ nodes: nextNodes, edges: new Set() })

      const before = docRef.current
      const startScreen = containerPoint(e)
      const origins = new Map<string, { x: number; y: number }>()
      for (const n of before.nodes) if (nextNodes.has(n.id)) origins.set(n.id, { x: n.x, y: n.y })
      let moved = false

      const onMove = (ev: PointerEvent): void => {
        const p = containerPoint(ev)
        if (!moved && Math.hypot(p.x - startScreen.x, p.y - startScreen.y) < DRAG_THRESHOLD) return
        moved = true
        const dwx = (p.x - startScreen.x) / transformRef.current.zoom
        const dwy = (p.y - startScreen.y) / transformRef.current.zoom
        const next: CanvasDoc = {
          ...docRef.current,
          nodes: docRef.current.nodes.map((n) => {
            const o = origins.get(n.id)
            return o ? { ...n, x: o.x + dwx, y: o.y + dwy } : n
          })
        }
        docRef.current = next
        setDoc(next)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (moved) commitGesture(before)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [commitGesture, containerPoint]
  )

  // ---- node resize (bottom-right handle) ----
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string): void => {
      e.stopPropagation()
      e.preventDefault()
      const before = docRef.current
      const node = before.nodes.find((n) => n.id === nodeId)
      if (!node) return
      const startScreen = containerPoint(e)
      const origin = { w: node.width, h: node.height }
      let moved = false
      const onMove = (ev: PointerEvent): void => {
        const p = containerPoint(ev)
        moved = true
        const dwx = (p.x - startScreen.x) / transformRef.current.zoom
        const dwy = (p.y - startScreen.y) / transformRef.current.zoom
        const next: CanvasDoc = {
          ...docRef.current,
          nodes: docRef.current.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, width: Math.max(120, origin.w + dwx), height: Math.max(60, origin.h + dwy) }
              : n
          )
        }
        docRef.current = next
        setDoc(next)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (moved) commitGesture(before)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [commitGesture, containerPoint]
  )

  // ---- edge creation (drag from a side port) ----
  const onPortPointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string, side: Side): void => {
      e.stopPropagation()
      e.preventDefault()
      const before = docRef.current
      let current: Linking = { fromNode: nodeId, fromSide: side, to: toWorld(e), overNode: null }
      setLinking(current)
      const onMove = (ev: PointerEvent): void => {
        const w = toWorld(ev)
        let over: string | null = null
        for (const n of docRef.current.nodes) {
          if (n.id === nodeId) continue
          if (pointInRect(w, nodeRect(n))) over = n.id // last match = topmost
        }
        current = { fromNode: nodeId, fromSide: side, to: w, overNode: over }
        setLinking(current)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setLinking(null)
        const target = current.overNode
        if (target && target !== nodeId) {
          undoStack.current.push(before)
          redoStack.current = []
          const edge = { id: genId(), fromNode: nodeId, fromSide: side, toNode: target, toEnd: 'arrow' as const }
          const next: CanvasDoc = { ...docRef.current, edges: [...docRef.current.edges, edge] }
          docRef.current = next
          setDoc(next)
          markDirty()
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [markDirty, toWorld]
  )

  // ---- text / link editing commit ----
  const commitNodeText = useCallback(
    (nodeId: string, value: string): void => {
      setEditingId(null)
      mutate((d) => ({
        ...d,
        nodes: d.nodes.map((n) => {
          if (n.id !== nodeId) return n
          if (n.type === 'text') return { ...n, text: value }
          if (n.type === 'link') return { ...n, url: value.trim() }
          if (n.type === 'group') return { ...n, label: value }
          return n
        })
      }))
    },
    [mutate]
  )

  // ---- drop a note from the sidebar ----
  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      const notePath = e.dataTransfer.getData(NOTE_DND_MIME)
      if (!notePath) return
      e.preventDefault()
      newFileNode(toWorld(e), notePath)
    },
    [newFileNode, toWorld]
  )

  // ---- keyboard ----
  useEffect(() => {
    const isTyping = (): boolean => {
      const el = document.activeElement
      return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || (el as HTMLElement).isContentEditable)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ' && !isTyping()) {
        setSpaceDown(true)
        return
      }
      if (isTyping()) {
        if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (mod && e.key === 'a') {
        e.preventDefault()
        setSelection({ nodes: new Set(docRef.current.nodes.map((n) => n.id)), edges: new Set() })
      } else if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelection()
      } else if (mod && e.key === '0') {
        e.preventDefault()
        resetZoom()
      } else if ((mod && e.key === '=') || (mod && e.key === '+')) {
        e.preventDefault()
        zoomTo(1.2)
      } else if (mod && e.key === '-') {
        e.preventDefault()
        zoomTo(1 / 1.2)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'Escape') {
        setSelection(emptySelection())
        setMenu(null)
      } else if (e.key === 'Enter') {
        const only = selectionRef.current.nodes.size === 1 ? [...selectionRef.current.nodes][0] : null
        const node = only ? docRef.current.nodes.find((n) => n.id === only) : null
        if (node && (node.type === 'text' || node.type === 'group')) {
          e.preventDefault()
          setEditingId(node.id)
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [deleteSelection, duplicateSelection, redo, resetZoom, undo, zoomTo])

  // Inline markdown rendering options for text cards (wikilinks resolve + navigate).
  const filePaths = files.map((f) => f.path)
  const renderOpts = {
    isResolved: (raw: string): boolean => !!(resolveTarget(raw, filePaths) ?? index.resolvePath(raw)),
    onNavigate: (raw: string): void => void navigate(raw),
    noPreview: true
  }

  const openFileNode = useCallback(
    (file: string, e: React.MouseEvent): void => {
      if (e.metaKey || e.ctrlKey) useStore.getState().openInSidePane(file)
      else openNote(file)
    },
    [openNote]
  )

  if (!loaded) return <div className="view-loading">Loading canvas…</div>

  const selNodes = doc.nodes.filter((n) => selection.nodes.has(n.id))
  const selBounds = nodesBounds(selNodes)
  // Floating toolbar position (screen space, above the selection).
  const toolbarPos =
    selBounds && !editingId && !linking
      ? worldToScreen({ x: selBounds.x + selBounds.width / 2, y: selBounds.y }, transform)
      : null

  return (
    <div
      className={'canvas-root' + (spaceDown ? ' panning' : '')}
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={(e) => {
        if (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('canvas-world'))
          newTextNode(toWorld(e))
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(NOTE_DND_MIME)) e.preventDefault()
      }}
      onDrop={onDrop}
    >
      {/* Dotted grid underlay — moves and scales with the viewport. */}
      <div
        className="canvas-grid"
        style={{
          backgroundSize: `${GRID * transform.zoom}px ${GRID * transform.zoom}px`,
          backgroundPosition: `${transform.tx}px ${transform.ty}px`
        }}
      />

      <div className="canvas-world" style={{ transform: cssTransform(transform) }}>
        <EdgesLayer
          doc={doc}
          selection={selection}
          linking={linking}
          onSelectEdge={(id, additive) =>
            setSelection((s) => ({
              nodes: additive ? s.nodes : new Set(),
              edges: additive ? new Set(s.edges).add(id) : new Set([id])
            }))
          }
        />
        {doc.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={selection.nodes.has(node.id)}
            editing={editingId === node.id}
            zoom={transform.zoom}
            renderOpts={renderOpts}
            noteText={node.type === 'file' ? useStore.getState().texts[node.file] : undefined}
            onPointerDown={onNodePointerDown}
            onResizePointerDown={onResizePointerDown}
            onPortPointerDown={onPortPointerDown}
            onStartEdit={(id) => setEditingId(id)}
            onCommitText={commitNodeText}
            onOpenFile={openFileNode}
            onContextMenu={(id, x, y) => {
              if (!selection.nodes.has(id)) setSelection({ nodes: new Set([id]), edges: new Set() })
              setMenu({ x, y, nodeId: id })
            }}
          />
        ))}
      </div>

      {marquee && (
        <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}

      {/* Selection toolbar — colours + duplicate + delete, floating above the selection. */}
      {toolbarPos && (
        <div
          className="canvas-sel-toolbar"
          style={{ left: toolbarPos.x, top: toolbarPos.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="sel-swatch sel-swatch-default" title="Default colour" onClick={() => setSelectionColor(undefined)} />
          {Object.entries(PRESET_COLORS).map(([key, hex]) => (
            <button
              key={key}
              className="sel-swatch"
              style={{ background: hex }}
              title={`Colour ${key}`}
              onClick={() => setSelectionColor(key)}
            />
          ))}
          <span className="sel-sep" />
          <button className="sel-btn" title="Duplicate (⌘D)" onClick={() => duplicateSelection()}>
            ⧉
          </button>
          <button className="sel-btn sel-btn-danger" title="Delete (⌫)" onClick={() => deleteSelection()}>
            ✕
          </button>
        </div>
      )}

      {/* Top-left: canvas name + add buttons. */}
      <div className="canvas-toolbar" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        {renaming ? (
          <input
            className="canvas-name-input"
            autoFocus
            defaultValue={canvasName}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              setRenaming(false)
              void renameCanvas(path, e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button className="canvas-name" title="Rename canvas" onDoubleClick={() => setRenaming(true)}>
            ▱ {canvasName}
          </button>
        )}
        <span className="canvas-tool-sep" />
        <button className="canvas-tool" title="Add text card" onClick={() => newTextNode(viewportCenter())}>
          ＋ Text
        </button>
        <button
          className="canvas-tool"
          title="Add a note card"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setPicker({ x: r.left, y: r.bottom + 6 })
          }}
        >
          ＋ Note
        </button>
        <button className="canvas-tool" title="Add a web link" onClick={() => newLinkNode(viewportCenter())}>
          ＋ Link
        </button>
      </div>

      {/* Bottom-right: zoom controls. */}
      <div className="canvas-controls" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <button className="canvas-tool" title="Zoom out (⌘-)" onClick={() => zoomTo(1 / 1.2)}>
          −
        </button>
        <button className="canvas-tool canvas-zoom" title="Reset to 100% (⌘0)" onClick={() => resetZoom()}>
          {Math.round(transform.zoom * 100)}%
        </button>
        <button className="canvas-tool" title="Zoom in (⌘+)" onClick={() => zoomTo(1.2)}>
          +
        </button>
        <button className="canvas-tool" title="Zoom to fit" onClick={() => zoomToFit()}>
          ⤢
        </button>
      </div>

      {doc.nodes.length === 0 && (
        <div className="canvas-hint">
          Double-click anywhere to add a card · drag a note in from the sidebar · scroll to pan, ⌘-scroll to zoom
        </div>
      )}

      {picker && (
        <NotePicker
          x={picker.x}
          y={picker.y}
          onPick={(p) => {
            newFileNode(viewportCenter(), p)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={nodeMenuItems(
            doc.nodes.find((n) => n.id === menu.nodeId),
            {
              edit: () => setEditingId(menu.nodeId),
              open: (file) => openNote(file),
              duplicate: duplicateSelection,
              del: deleteSelection
            }
          )}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function nodeMenuItems(
  node: CanvasNode | undefined,
  actions: { edit: () => void; open: (file: string) => void; duplicate: () => void; del: () => void }
): MenuItem[] {
  const items: MenuItem[] = []
  if (node?.type === 'file') items.push({ label: 'Open note', onClick: () => actions.open(node.file) })
  if (node?.type === 'link' && node.url) items.push({ label: 'Open link', onClick: () => openLinkTarget(node.url) })
  if (node?.type === 'text' || node?.type === 'group' || node?.type === 'link')
    items.push({ label: 'Edit', onClick: actions.edit })
  items.push({ label: 'Duplicate', onClick: actions.duplicate })
  items.push({ label: 'Delete', danger: true, onClick: actions.del })
  return items
}

// ---- edges ----

function EdgesLayer({
  doc,
  selection,
  linking,
  onSelectEdge
}: {
  doc: CanvasDoc
  selection: Selection
  linking: Linking | null
  onSelectEdge: (id: string, additive: boolean) => void
}): React.JSX.Element {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  return (
    <svg className="canvas-edges" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <defs>
        <marker id="canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
      {doc.edges.map((e) => {
        const from = byId.get(e.fromNode)
        const to = byId.get(e.toNode)
        if (!from || !to) return null
        const { a, aSide, b, bSide } = edgeEnds(e, nodeRect(from), nodeRect(to))
        const d = edgePath(a, aSide, b, bSide)
        const color = resolveColor(e.color) ?? 'var(--text-dim)'
        const selected = selection.edges.has(e.id)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        return (
          <g key={e.id} className={'canvas-edge' + (selected ? ' selected' : '')}>
            <path
              className="canvas-edge-hit"
              d={d}
              onPointerDown={(ev) => {
                ev.stopPropagation()
                onSelectEdge(e.id, ev.shiftKey)
              }}
            />
            <path
              className="canvas-edge-line"
              d={d}
              style={{ stroke: selected ? 'var(--accent)' : color }}
              markerEnd={e.toEnd === 'none' ? undefined : 'url(#canvas-arrow)'}
              markerStart={e.fromEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}
            />
            {e.label && (
              <text className="canvas-edge-label" x={mid.x} y={mid.y} textAnchor="middle">
                {e.label}
              </text>
            )}
          </g>
        )
      })}
      {linking &&
        (() => {
          const from = byId.get(linking.fromNode)
          if (!from) return null
          const a = sideAnchor(nodeRect(from), linking.fromSide)
          const d = `M ${a.x} ${a.y} L ${linking.to.x} ${linking.to.y}`
          return <path className="canvas-edge-ghost" d={d} markerEnd="url(#canvas-arrow)" />
        })()}
    </svg>
  )
}

// ---- a single node card ----

interface NodeCardProps {
  node: CanvasNode
  selected: boolean
  editing: boolean
  zoom: number
  renderOpts: { isResolved: (raw: string) => boolean; onNavigate: (raw: string) => void; noPreview: boolean }
  noteText: string | undefined
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onResizePointerDown: (e: React.PointerEvent, id: string) => void
  onPortPointerDown: (e: React.PointerEvent, id: string, side: Side) => void
  onStartEdit: (id: string) => void
  onCommitText: (id: string, value: string) => void
  onOpenFile: (file: string, e: React.MouseEvent) => void
  onContextMenu: (id: string, x: number, y: number) => void
}

const NodeCard = memo(function NodeCard({
  node,
  selected,
  editing,
  renderOpts,
  noteText,
  onPointerDown,
  onResizePointerDown,
  onPortPointerDown,
  onStartEdit,
  onCommitText,
  onOpenFile,
  onContextMenu
}: NodeCardProps): React.JSX.Element {
  const color = resolveColor(node.color)
  const style: React.CSSProperties = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(color ? ({ '--node-color': color } as React.CSSProperties) : {})
  }
  const isGroup = node.type === 'group'
  return (
    <div
      className={
        'canvas-node canvas-node-' + node.type + (selected ? ' selected' : '') + (color ? ' colored' : '')
      }
      style={style}
      onPointerDown={(e) => onPointerDown(e, node.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(node.id, e.clientX, e.clientY)
      }}
    >
      {/* Inner wrapper clips content to the rounded card; ports/resize sit outside it so
          they straddle the edge without being clipped. */}
      <div className="canvas-node-inner">
      {node.type === 'text' &&
        (editing ? (
          <textarea
            className="canvas-node-edit"
            autoFocus
            defaultValue={node.text}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => onCommitText(node.id, e.currentTarget.value)}
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          />
        ) : (
          <div className="canvas-node-body" onDoubleClick={() => onStartEdit(node.id)}>
            {node.text.trim() ? (
              renderCardBody(node.text, renderOpts)
            ) : (
              <span className="canvas-node-placeholder">Empty card — double-click to edit</span>
            )}
          </div>
        ))}

      {node.type === 'file' && (
        <div
          className="canvas-node-file"
          onDoubleClick={(e) => onOpenFile(node.file, e)}
          title={`${node.file} — double-click to open`}
        >
          <div className="canvas-file-head">
            <span className="canvas-file-name">{fileNodeName(node.file)}</span>
            <button
              className="canvas-file-open"
              title="Open note"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => onOpenFile(node.file, e)}
            >
              ↗
            </button>
          </div>
          <div className="canvas-file-preview">
            {noteText === undefined ? (
              <span className="canvas-node-placeholder">Missing note</span>
            ) : (
              renderCardBody(stripFrontmatter(noteText).slice(0, 600), renderOpts)
            )}
          </div>
        </div>
      )}

      {node.type === 'link' &&
        (editing ? (
          <input
            className="canvas-node-edit canvas-link-edit"
            autoFocus
            placeholder="https://…"
            defaultValue={node.url}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => onCommitText(node.id, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        ) : (
          <LinkCard url={node.url} onEdit={() => onStartEdit(node.id)} />
        ))}

      {isGroup &&
        (editing ? (
          <input
            className="canvas-group-label-edit"
            autoFocus
            defaultValue={node.label ?? ''}
            placeholder="Group label"
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => onCommitText(node.id, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        ) : (
          <div className="canvas-group-label" onDoubleClick={() => onStartEdit(node.id)}>
            {node.label || 'Group'}
          </div>
        ))}
      </div>

      {/* Connection ports (shown on hover/selection via CSS). */}
      {!isGroup &&
        SIDES.map((side) => (
          <div
            key={side}
            className={'canvas-port canvas-port-' + side}
            onPointerDown={(e) => onPortPointerDown(e, node.id, side)}
            title="Drag to connect"
          />
        ))}

      {/* Resize handle. */}
      <div className="canvas-resize" onPointerDown={(e) => onResizePointerDown(e, node.id)} title="Resize" />
    </div>
  )
})

function LinkCard({ url, onEdit }: { url: string; onEdit: () => void }): React.JSX.Element {
  const [title, setTitle] = useState<string | null>(() => titleCache.get(url) ?? null)
  useEffect(() => {
    if (!url || titleCache.has(url)) return
    let alive = true
    void window.verso.fetchTitle(url).then((t) => {
      if (!alive) return
      const val = t ?? ''
      titleCache.set(url, val)
      setTitle(val)
    })
    return () => {
      alive = false
    }
  }, [url])
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep raw */
  }
  if (!url) {
    return (
      <div className="canvas-link" onDoubleClick={onEdit}>
        <span className="canvas-node-placeholder">Empty link — double-click to set a URL</span>
      </div>
    )
  }
  return (
    <div className="canvas-link" onDoubleClick={onEdit}>
      <img
        className="canvas-link-favicon"
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
      />
      <div className="canvas-link-text">
        <div className="canvas-link-title">{title || host}</div>
        <a
          className="canvas-link-url"
          href={url}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            openLinkTarget(url)
          }}
        >
          {host}
        </a>
      </div>
    </div>
  )
}

/** Render a card's markdown: headings, bullets, and inline formatting incl. wikilinks. */
function renderCardBody(
  text: string,
  opts: { isResolved: (raw: string) => boolean; onNavigate: (raw: string) => void; noPreview: boolean }
): React.ReactNode {
  return text.split('\n').map((line, i) => {
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const Tag = `h${Math.min(h[1].length + 2, 6)}` as keyof React.JSX.IntrinsicElements
      return (
        <Tag key={i} className="canvas-md-h">
          {renderInline(h[2], opts)}
        </Tag>
      )
    }
    const b = line.match(/^\s*[-*]\s+(.*)$/)
    if (b) {
      return (
        <div key={i} className="canvas-md-bullet">
          <span className="canvas-md-dot">•</span>
          <span>{renderInline(b[1], opts)}</span>
        </div>
      )
    }
    if (!line.trim()) return <div key={i} className="canvas-md-gap" />
    return <div key={i}>{renderInline(line, opts)}</div>
  })
}

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  return end === -1 ? text : text.slice(text.indexOf('\n', end + 1) + 1)
}

// ---- note picker popover ----

function NotePicker({
  x,
  y,
  onPick,
  onClose
}: {
  x: number
  y: number
  onPick: (path: string) => void
  onClose: () => void
}): React.JSX.Element {
  const files = useStore((s) => s.files)
  const [q, setQ] = useState('')
  const filtered = files
    .filter((f) => f.name.toLowerCase().includes(q.toLowerCase()) || f.path.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 50)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <>
      <div className="canvas-picker-backdrop" onPointerDown={onClose} />
      <div className="canvas-picker" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
        <input
          className="canvas-picker-input"
          autoFocus
          placeholder="Find a note…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="canvas-picker-list">
          {filtered.length === 0 && <div className="canvas-picker-empty">No notes</div>}
          {filtered.map((f) => (
            <button key={f.path} className="canvas-picker-item" onClick={() => onPick(f.path)} title={f.path}>
              <span className="canvas-picker-name">{f.name}</span>
              {f.path.includes('/') && <span className="canvas-picker-path">{f.path.slice(0, f.path.lastIndexOf('/'))}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
