import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from './LazyForceGraph'
import { useGraphColors } from './GraphView'
import { useStore } from '../store'
import type { GraphNode } from '../lib/vault'

/** A compact neighbours-of-the-current-note graph for the right sidebar. */
export function LocalGraph({ path }: { path: string }): React.JSX.Element | null {
  const index = useStore((s) => s.index)
  const openNote = useStore((s) => s.openNote)
  const colors = useGraphColors()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(248)

  const data = useMemo(() => index.localGraph(path), [index, path])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = (): void => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // Nothing to show if the note has no connections.
  if (data.nodes.length <= 1) return null

  return (
    <div className="localgraph">
      <button className="rightbar-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="rightbar-caret">{open ? '▾' : '▸'}</span>
        Local graph
        <span className="rightbar-section-count">{data.nodes.length - 1}</span>
      </button>
      {open && (
        <div className="localgraph-canvas" ref={wrapRef}>
          <Suspense fallback={null}>
          <ForceGraph2D
            graphData={data}
            width={width}
            height={200}
            backgroundColor="transparent"
            nodeRelSize={3}
            linkColor={() => colors.border}
            linkWidth={1}
            d3VelocityDecay={0.4}
            cooldownTicks={60}
            onNodeClick={(node: GraphNode) => {
              if (!node.phantom) openNote(node.id)
            }}
            nodeCanvasObject={(node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, scale: number) => {
              const isCenter = node.id === path
              const r = isCenter ? 3.5 : 2.5
              const x = node.x ?? 0
              const y = node.y ?? 0
              ctx.beginPath()
              ctx.arc(x, y, r, 0, 2 * Math.PI)
              ctx.fillStyle = node.phantom ? colors.textFaint : isCenter ? colors.accent : colors.link
              ctx.fill()
              const label = node.name.length > 18 ? node.name.slice(0, 17) + '…' : node.name
              ctx.font = `${7 / scale + 1.5}px -apple-system, sans-serif`
              ctx.fillStyle = colors.textDim
              ctx.textAlign = 'center'
              ctx.fillText(label, x, y + r + 5)
            }}
          />
          </Suspense>
        </div>
      )}
    </div>
  )
}
