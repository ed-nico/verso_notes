/**
 * The data model + geometry for the spatial canvas (whiteboard).
 *
 * On-disk format is **Obsidian-compatible `.canvas` JSON** (`{ nodes, edges }`), so a
 * Verso canvas opens in Obsidian and vice-versa — the vault stays interoperable rather
 * than locked into a Verso-only shape. This module is pure (no React, no I/O) so the
 * geometry can be unit-tested and reused by the view and the minimap alike.
 */

/** DnD MIME the sidebar tags a note row with, so it can be dropped onto a canvas. */
export const NOTE_DND_MIME = 'application/x-inkwell-note'

/** A node colour: a preset slot "1".."6" (Obsidian's palette) or an explicit "#rrggbb". */
export type CanvasColor = string

export interface CanvasNodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
}
/** A free-floating markdown text card. */
export interface TextNode extends CanvasNodeBase {
  type: 'text'
  text: string
}
/** A card backed by a vault note (`file` = workspace-relative path, e.g. "Projects/Alpha.md"). */
export interface FileNode extends CanvasNodeBase {
  type: 'file'
  file: string
  subpath?: string
}
/** A web link card. */
export interface LinkNode extends CanvasNodeBase {
  type: 'link'
  url: string
}
/** A labelled frame that visually groups the nodes sitting on top of it. */
export interface GroupNode extends CanvasNodeBase {
  type: 'group'
  label?: string
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode
export type CanvasNodeType = CanvasNode['type']

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type EndCap = 'none' | 'arrow'

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  toNode: string
  toSide?: Side
  color?: CanvasColor
  label?: string
  fromEnd?: EndCap
  toEnd?: EndCap
}

export interface CanvasDoc {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
/** The viewport transform: world = screen mapped by `translate(tx,ty) scale(zoom)`. */
export interface Transform {
  tx: number
  ty: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/** Obsidian's six preset colours, resolved to hexes that read well on dark *and* light. */
export const PRESET_COLORS: Record<string, string> = {
  '1': '#e5544b', // red
  '2': '#e08c3e', // orange
  '3': '#d9b020', // yellow
  '4': '#46a758', // green
  '5': '#22a0c8', // cyan
  '6': '#9a6bd8' // purple
}

/** Resolve a node/edge colour to a concrete hex, or null for "use the default theme colour". */
export function resolveColor(color: CanvasColor | undefined): string | null {
  if (!color) return null
  if (PRESET_COLORS[color]) return PRESET_COLORS[color]
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return color
  return null
}

/** A 16-char hex id, matching Obsidian's node/edge id shape. */
export function genId(): string {
  let s = ''
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

export function emptyDoc(): CanvasDoc {
  return { nodes: [], edges: [] }
}

/** Coerce arbitrary parsed JSON into a well-formed CanvasDoc (defensive: external files). */
export function normalizeDoc(raw: unknown): CanvasDoc {
  const obj = (raw ?? {}) as { nodes?: unknown; edges?: unknown }
  const nodes = Array.isArray(obj.nodes) ? (obj.nodes.filter(isValidNode) as CanvasNode[]) : []
  const ids = new Set(nodes.map((n) => n.id))
  const edges = Array.isArray(obj.edges)
    ? (obj.edges.filter((e) => isValidEdge(e, ids)) as CanvasEdge[])
    : []
  return { nodes, edges }
}

function isValidNode(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false
  const o = n as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    (o.type === 'text' || o.type === 'file' || o.type === 'link' || o.type === 'group')
  )
}
function isValidEdge(e: unknown, nodeIds: Set<string>): boolean {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.fromNode === 'string' &&
    typeof o.toNode === 'string' &&
    nodeIds.has(o.fromNode as string) &&
    nodeIds.has(o.toNode as string)
  )
}

// ---- geometry ----

export function nodeRect(n: CanvasNodeBase): Rect {
  return { x: n.x, y: n.y, width: n.width, height: n.height }
}
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/** The connection anchor point on one side of a node, in world coordinates. */
export function sideAnchor(r: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y }
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height }
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 }
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 }
  }
}

/** Outward unit normal for a side (points away from the node). */
export function sideNormal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
  }
}

/** When an edge end has no explicit side, pick the side of `from` that best faces `to`. */
export function autoSide(from: Rect, to: Rect): Side {
  const a = rectCenter(from)
  const b = rectCenter(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/**
 * A smooth cubic-bezier path between two side anchors, with control points pushed out
 * along each side's normal so the curve leaves and enters perpendicular to the cards
 * (the clean "flow chart" look). Returns an SVG path `d` string.
 */
export function edgePath(a: Point, aSide: Side, b: Point, bSide: Side): string {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.max(30, Math.min(dist * 0.4, 180))
  const an = sideNormal(aSide)
  const bn = sideNormal(bSide)
  const c1 = { x: a.x + an.x * k, y: a.y + an.y * k }
  const c2 = { x: b.x + bn.x * k, y: b.y + bn.y * k }
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
}

/** Resolve the concrete endpoints (with auto-sides filled in) for an edge. */
export function edgeEnds(
  edge: CanvasEdge,
  from: Rect,
  to: Rect
): { a: Point; aSide: Side; b: Point; bSide: Side } {
  const aSide = edge.fromSide ?? autoSide(from, to)
  const bSide = edge.toSide ?? autoSide(to, from)
  return { a: sideAnchor(from, aSide), aSide, b: sideAnchor(to, bSide), bSide }
}

/** Bounding box of a set of nodes (null when empty). */
export function nodesBounds(nodes: CanvasNodeBase[]): Rect | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

/** Screen (container-relative) point → world point under the current transform. */
export function screenToWorld(p: Point, t: Transform): Point {
  return { x: (p.x - t.tx) / t.zoom, y: (p.y - t.ty) / t.zoom }
}
/** World point → screen (container-relative) point. */
export function worldToScreen(p: Point, t: Transform): Point {
  return { x: p.x * t.zoom + t.tx, y: p.y * t.zoom + t.ty }
}

/** A transform that fits `bounds` inside a `width`×`height` viewport with `pad` px margin. */
export function fitTransform(bounds: Rect, width: number, height: number, pad = 80): Transform {
  if (bounds.width <= 0 || bounds.height <= 0) {
    const zoom = 1
    return { zoom, tx: width / 2 - rectCenter(bounds).x * zoom, ty: height / 2 - rectCenter(bounds).y * zoom }
  }
  const zoom = clampZoom(Math.min((width - pad * 2) / bounds.width, (height - pad * 2) / bounds.height))
  const c = rectCenter(bounds)
  return { zoom, tx: width / 2 - c.x * zoom, ty: height / 2 - c.y * zoom }
}

/** Zoom toward a fixed screen point (keeps the world point under the cursor stationary). */
export function zoomAt(t: Transform, nextZoom: number, screen: Point): Transform {
  const zoom = clampZoom(nextZoom)
  const world = screenToWorld(screen, t)
  return { zoom, tx: screen.x - world.x * zoom, ty: screen.y - world.y * zoom }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

/** Default size for a freshly created node of each type. */
export function defaultSize(type: CanvasNodeType): { width: number; height: number } {
  switch (type) {
    case 'text':
      return { width: 260, height: 120 }
    case 'file':
      return { width: 300, height: 200 }
    case 'link':
      return { width: 300, height: 120 }
    case 'group':
      return { width: 420, height: 320 }
  }
}

/** A short display name for a note path (filename without extension). */
export function fileNodeName(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1)
  return base.replace(/\.md$/i, '')
}
