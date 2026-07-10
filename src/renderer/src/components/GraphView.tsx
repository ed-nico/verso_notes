import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from './LazyForceGraph'
import { useStore } from '../store'
import type { GraphNode, GraphLink } from '../lib/vault'

/** A force-graph link's endpoint is a node id until the lib mutates it into a node object. */
const endpointId = (e: unknown): string =>
  typeof e === 'object' && e !== null ? (e as { id: string }).id : (e as string)

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

  const data = useMemo(() => index.graph(), [index])

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

      <Suspense fallback={<div className="view-loading">Loading graph…</div>}>
        <ForceGraph2D
          ref={fgRef}
          graphData={shown}
          width={size.w}
          height={size.h}
          backgroundColor="#1a1a1e"
          nodeRelSize={4}
          linkColor={(l: GraphLink) => {
            if (!matched) return '#3a3a44'
            return matched.has(endpointId(l.source)) && matched.has(endpointId(l.target)) ? '#5663c9' : '#26262e'
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
                ? '#34343c' // searching, not a match → dimmed
                : isMatch || isActive
                  ? '#7c8cff'
                  : node.phantom
                    ? '#4a4a52'
                    : '#8fa1ff'
            ctx.fill()
            if (isMatch || showLabels || scale > 1.2) {
              ctx.font = `${11 / scale + 3}px -apple-system, sans-serif`
              ctx.fillStyle = isMatch === false ? '#4d4d55' : isMatch ? '#dfe2ff' : '#b8b8c4'
              ctx.textAlign = 'center'
              ctx.fillText(node.name, x, y + r + 9)
            }
          }}
        />
      </Suspense>
    </div>
  )
}
