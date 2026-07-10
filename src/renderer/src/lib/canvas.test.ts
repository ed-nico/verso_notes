import { describe, expect, it } from 'vitest'
import {
  autoSide,
  clampZoom,
  edgeEnds,
  edgePath,
  fitTransform,
  genId,
  nodesBounds,
  normalizeDoc,
  rectsIntersect,
  resolveColor,
  screenToWorld,
  sideAnchor,
  worldToScreen,
  zoomAt,
  type CanvasEdge,
  type Rect,
  type Transform
} from './canvas'

const rect = (x: number, y: number, w = 100, h = 60): Rect => ({ x, y, width: w, height: h })

describe('sideAnchor', () => {
  it('places anchors at the midpoints of each side', () => {
    const r = rect(0, 0, 100, 60)
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 })
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 60 })
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 30 })
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 30 })
  })
})

describe('autoSide', () => {
  it('faces the neighbour horizontally when the gap is mostly horizontal', () => {
    expect(autoSide(rect(0, 0), rect(400, 10))).toBe('right')
    expect(autoSide(rect(400, 0), rect(0, 10))).toBe('left')
  })
  it('faces vertically when the gap is mostly vertical', () => {
    expect(autoSide(rect(0, 0), rect(10, 400))).toBe('bottom')
    expect(autoSide(rect(0, 400), rect(10, 0))).toBe('top')
  })
})

describe('edgeEnds', () => {
  it('fills in opposing auto-sides for two side-by-side nodes', () => {
    const from = rect(0, 0)
    const to = rect(400, 0)
    const ends = edgeEnds({ id: 'e', fromNode: 'a', toNode: 'b' } as CanvasEdge, from, to)
    expect(ends.aSide).toBe('right')
    expect(ends.bSide).toBe('left')
    expect(ends.a).toEqual({ x: 100, y: 30 })
    expect(ends.b).toEqual({ x: 400, y: 30 })
  })
  it('respects explicit sides', () => {
    const ends = edgeEnds(
      { id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'top', toSide: 'bottom' },
      rect(0, 0),
      rect(400, 0)
    )
    expect(ends.aSide).toBe('top')
    expect(ends.bSide).toBe('bottom')
  })
})

describe('edgePath', () => {
  it('produces a cubic bezier starting and ending at the anchors', () => {
    const d = edgePath({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left')
    expect(d.startsWith('M 0 0 C')).toBe(true)
    expect(d.endsWith('200 0')).toBe(true)
  })
})

describe('transforms', () => {
  const t: Transform = { tx: 50, ty: 20, zoom: 2 }
  it('round-trips screen <-> world', () => {
    const world = { x: 13, y: 99 }
    const screen = worldToScreen(world, t)
    expect(screenToWorld(screen, t)).toEqual(world)
  })
  it('zoomAt keeps the point under the cursor fixed', () => {
    const cursor = { x: 300, y: 200 }
    const before = screenToWorld(cursor, t)
    const t2 = zoomAt(t, 3.3, cursor)
    const after = screenToWorld(cursor, t2)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
})

describe('clampZoom', () => {
  it('clamps to [0.1, 4]', () => {
    expect(clampZoom(0.001)).toBe(0.1)
    expect(clampZoom(99)).toBe(4)
    expect(clampZoom(1.5)).toBe(1.5)
  })
})

describe('fitTransform', () => {
  it('centres the bounds in the viewport', () => {
    const bounds = rect(0, 0, 400, 200)
    const t = fitTransform(bounds, 1000, 800, 50)
    const centerScreen = worldToScreen({ x: 200, y: 100 }, t)
    expect(centerScreen.x).toBeCloseTo(500, 4)
    expect(centerScreen.y).toBeCloseTo(400, 4)
  })
})

describe('nodesBounds', () => {
  it('returns null for no nodes', () => {
    expect(nodesBounds([])).toBeNull()
  })
  it('spans all nodes', () => {
    const b = nodesBounds([
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 200, y: 50, width: 100, height: 100 }
    ])
    expect(b).toEqual({ x: 0, y: 0, width: 300, height: 150 })
  })
})

describe('rectsIntersect', () => {
  it('detects overlap and separation', () => {
    expect(rectsIntersect(rect(0, 0), rect(50, 30))).toBe(true)
    expect(rectsIntersect(rect(0, 0), rect(500, 500))).toBe(false)
  })
})

describe('resolveColor', () => {
  it('maps presets and passes hex through', () => {
    expect(resolveColor('1')).toBe('#e5544b')
    expect(resolveColor('#abc')).toBe('#abc')
    expect(resolveColor('#a1b2c3')).toBe('#a1b2c3')
    expect(resolveColor(undefined)).toBeNull()
    expect(resolveColor('garbage')).toBeNull()
  })
})

describe('normalizeDoc', () => {
  it('keeps valid nodes/edges and drops malformed ones', () => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'a', type: 'text', text: 'hi', x: 0, y: 0, width: 100, height: 50 },
        { id: 'bad', type: 'nope', x: 0, y: 0, width: 1, height: 1 },
        { id: 'b', type: 'file', file: 'N.md', x: 10, y: 10, width: 100, height: 50 }
      ],
      edges: [
        { id: 'e1', fromNode: 'a', toNode: 'b' },
        { id: 'e2', fromNode: 'a', toNode: 'ghost' }
      ]
    })
    expect(doc.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(doc.edges.map((e) => e.id)).toEqual(['e1'])
  })
  it('tolerates junk input', () => {
    expect(normalizeDoc(null)).toEqual({ nodes: [], edges: [] })
    expect(normalizeDoc({ nodes: 'x', edges: 5 })).toEqual({ nodes: [], edges: [] })
  })
})

describe('genId', () => {
  it('is 16 hex chars', () => {
    expect(genId()).toMatch(/^[0-9a-f]{16}$/)
  })
})
