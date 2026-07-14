import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from './LazyForceGraph'
import { useStore } from '../store'
import type { GraphNode, GraphLink } from '../lib/vault'

/** A force-graph link's endpoint is a node id until the lib mutates it into a node object. */
const endpointId = (e: unknown): string =>
  typeof e === 'object' && e !== null ? (e as { id: string }).id : (e as string)

/** The palette slice the canvas graphs paint with, resolved from the CSS variables. */
export interface GraphColors {
  bg: string
  text: string
  textDim: string
  textFaint: string
  border: string
  bgHover: string
  accent: string
  accentDim: string
  link: string
}

const readGraphColors = (): GraphColors => {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  return {
    bg: v('--bg'),
    text: v('--text'),
    textDim: v('--text-dim'),
    textFaint: v('--text-faint'),
    border: v('--border'),
    bgHover: v('--bg-hover'),
    accent: v('--accent'),
    accentDim: v('--accent-dim'),
    link: v('--link')
  }
}

/** Resolved theme/accent colors for canvas drawing (canvas can't use `var(...)`). App.tsx
 *  writes `data-theme` and the accent variables onto the root element in its own effects,
 *  which run *after* a child component's — so re-read one frame later, once the new
 *  palette is actually on the DOM. */
export function useGraphColors(): GraphColors {
  const theme = useStore((s) => s.theme)
  const accent = useStore((s) => s.accent)
  const [colors, setColors] = useState(readGraphColors)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setColors(readGraphColors()))
    return () => cancelAnimationFrame(raf)
  }, [theme, accent])
  return colors
}

export function GraphView(): React.JSX.Element {
  const index = useStore((s) => s.index)
  const activePath = useStore((s) => s.activePath)
  const openNote = useStore((s) => s.openNote)
  const wrapRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  // ---- display / filter / force options (Logseq/Obsidian-style) ----
  const [search, setSearch] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [showOrphans, setShowOrphans] = useState(true)
  const [showUnresolved, setShowUnresolved] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [nodeSize, setNodeSize] = useState(1)
  const [linkDist, setLinkDist] = useState(40)
  const [repel, setRepel] = useState(60)
  const colors = useGraphColors()

  // index.graph() mints all-new node objects on every index rebuild (~200ms after each
  // keystroke while this pane is open). force-graph stores x/y/vx/vy on the node objects
  // themselves, so reuse (mutate) the previous object for every id that survives — only
  // genuinely new notes get fresh nodes and a fresh random position. Links can stay plain
  // {source, target} id pairs; the lib resolves them against the node array.
  const nodesRef = useRef(new Map<string, GraphNode>())
  const data = useMemo(() => {
    const g = index.graph()
    const next = new Map<string, GraphNode>()
    const nodes = g.nodes.map((n) => {
      const prev = nodesRef.current.get(n.id)
      const node = prev ?? n
      if (prev) {
        prev.name = n.name
        prev.degree = n.degree
        prev.phantom = n.phantom
      }
      next.set(n.id, node)
      return node
    })
    nodesRef.current = next
    return { nodes, links: g.links }
  }, [index])

  // Filter nodes/links per the toggles. Node object identity is preserved so the layout
  // doesn't fully reset when toggling (force-graph keeps each node's x/y by reference).
  const shown = useMemo(() => {
    let nodes = data.nodes
    let links = data.links
    if (!showUnresolved) {
      nodes = nodes.filter((n) => !n.phantom)
      const ids = new Set(nodes.map((n) => n.id))
      links = links.filter((l) => ids.has(endpointId(l.source)) && ids.has(endpointId(l.target)))
    }
    if (!showOrphans) {
      const linked = new Set<string>()
      for (const l of links) {
        linked.add(endpointId(l.source))
        linked.add(endpointId(l.target))
      }
      nodes = nodes.filter((n) => linked.has(n.id))
    }
    return { nodes, links } as { nodes: GraphNode[]; links: GraphLink[] }
  }, [data, showOrphans, showUnresolved])

  // Nodes matching the search box (null when the box is empty → no highlighting).
  const matched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const s = new Set<string>()
    for (const n of shown.nodes) if (n.name.toLowerCase().includes(q)) s.add(n.id)
    return s
  }, [search, shown])

  // Zoom to fit the matches when a search yields results.
  useEffect(() => {
    if (matched && matched.size) fgRef.current?.zoomToFit?.(500, 80, (n: GraphNode) => matched.has(n.id))
  }, [matched])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = (): void => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Push the force sliders into d3 and reheat so changes animate smoothly (no relayout).
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('link')?.distance(linkDist)
    fg.d3Force('charge')?.strength(-repel)
    fg.d3ReheatSimulation?.()
  }, [linkDist, repel, shown])

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <div className="graph-controls">
        <input
          className="graph-search"
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="graph-controls-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          title="Graph display options"
        >
          ⚙ Display
        </button>
        {panelOpen && (
          <div className="graph-panel">
            <div className="graph-panel-group">Filters</div>
            <label className="graph-opt">
              <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
              Orphans (no links)
            </label>
            <label className="graph-opt">
              <input type="checkbox" checked={showUnresolved} onChange={(e) => setShowUnresolved(e.target.checked)} />
              Unresolved notes
            </label>

            <div className="graph-panel-group">Display</div>
            <label className="graph-opt">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
              Always show labels
            </label>
            <label className="graph-opt col">
              <span>Node size</span>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.1}
                value={nodeSize}
                onChange={(e) => setNodeSize(Number(e.target.value))}
              />
            </label>

            <div className="graph-panel-group">Forces</div>
            <label className="graph-opt col">
              <span>Link distance</span>
              <input
                type="range"
                min={10}
                max={160}
                step={5}
                value={linkDist}
                onChange={(e) => setLinkDist(Number(e.target.value))}
              />
            </label>
            <label className="graph-opt col">
              <span>Repel force</span>
              <input
                type="range"
                min={10}
                max={300}
                step={10}
                value={repel}
                onChange={(e) => setRepel(Number(e.target.value))}
              />
            </label>

            <div className="graph-panel-foot">
              {shown.nodes.length} nodes · {shown.links.length} links
            </div>
          </div>
        )}
      </div>

      {data.nodes.length === 0 || data.links.length === 0 ? (
        <div className="bases-empty">
          <p className="empty-note">
            {data.nodes.length === 0
              ? 'No notes yet — create one to start your graph.'
              : 'Link notes with [[wikilinks]] to grow the graph.'}
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="view-loading">Loading graph…</div>}>
          <ForceGraph2D
            ref={fgRef}
            graphData={shown}
            width={size.w}
            height={size.h}
            backgroundColor={colors.bg}
            nodeRelSize={4}
            linkColor={(l: GraphLink) => {
              if (!matched) return colors.border
              return matched.has(endpointId(l.source)) && matched.has(endpointId(l.target))
                ? colors.accentDim
                : colors.bgHover
            }}
            linkWidth={1}
            d3VelocityDecay={0.3}
            onNodeClick={(node: GraphNode) => {
              if (!node.phantom) openNote(node.id)
            }}
            nodeCanvasObject={(node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, scale: number) => {
              const r = Math.max(3, Math.min(10, 3 + node.degree)) * nodeSize // size by degree
              const x = node.x ?? 0
              const y = node.y ?? 0
              const isActive = node.id === activePath
              const isMatch = matched ? matched.has(node.id) : null
              ctx.beginPath()
              ctx.arc(x, y, r, 0, 2 * Math.PI)
              ctx.fillStyle =
                isMatch === false
                  ? colors.border // searching, not a match → dimmed
                  : isMatch || isActive
                    ? colors.accent
                    : node.phantom
                      ? colors.textFaint
                      : colors.link
              ctx.fill()
              if (isMatch || showLabels || scale > 1.2) {
                ctx.font = `${11 / scale + 3}px -apple-system, sans-serif`
                ctx.fillStyle = isMatch === false ? colors.textFaint : isMatch ? colors.text : colors.textDim
                ctx.textAlign = 'center'
                ctx.fillText(node.name, x, y + r + 9)
              }
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
