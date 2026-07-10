import { describe, it, expect } from 'vitest'
import { VaultIndex } from './vault'
import { parseNote } from './parse'

function index(files: Record<string, string>): VaultIndex {
  const notes = Object.entries(files).map(([p, t]) => parseNote(p, t))
  return new VaultIndex(notes, files)
}

describe('backlinks', () => {
  it('records a backlink from a linking note to its target', () => {
    const idx = index({ 'A.md': 'see [[B]]', 'B.md': 'hello' })
    const back = idx.backlinksFor('B.md')
    expect(back).toHaveLength(1)
    expect(back[0].sourcePath).toBe('A.md')
    expect(back[0].context).toContain('[[B]]')
  })

  it('counts distinct source notes only', () => {
    const idx = index({ 'A.md': '[[B]] and again [[B]]', 'B.md': 'x' })
    expect(idx.backlinkCount('B.md')).toBe(1)
  })

  it('ignores self-links', () => {
    const idx = index({ 'A.md': 'I link to [[A]]' })
    expect(idx.backlinkCount('A.md')).toBe(0)
  })
})

describe('unlinkedReferences', () => {
  it('finds plain-text mentions that are not wikilinks', () => {
    const idx = index({
      'B.md': 'home',
      'C.md': 'I talked about B today',
      'D.md': 'and [[B]] is linked here'
    })
    const refs = idx.unlinkedReferences('B.md')
    const sources = refs.map((r) => r.sourcePath)
    expect(sources).toContain('C.md')
    expect(sources).not.toContain('D.md') // already a wikilink
  })
})

describe('graph', () => {
  it('includes resolved notes and phantom nodes for unresolved links', () => {
    const idx = index({ 'A.md': '[[B]] and [[Ghost]]', 'B.md': 'x' })
    const g = idx.graph()
    const ids = g.nodes.map((n) => n.id)
    expect(ids).toContain('A.md')
    expect(ids).toContain('B.md')
    expect(ids).toContain('phantom:Ghost')
    expect(g.nodes.find((n) => n.id === 'phantom:Ghost')?.phantom).toBe(true)
  })

  it('localGraph centers on a note and includes its neighbours', () => {
    const idx = index({ 'A.md': '[[B]]', 'B.md': 'x', 'C.md': '[[B]]' })
    const g = idx.localGraph('B.md')
    const ids = g.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['A.md', 'B.md', 'C.md'])
  })
})

describe('aliases', () => {
  it('resolves a wikilink to a note via its frontmatter alias', () => {
    const idx = index({
      'People/Mara Lindqvist.md': '---\naliases: [Mara, ML]\n---\nbio',
      'Note.md': 'met [[Mara]] today'
    })
    expect(idx.resolvePath('Mara')).toBe('People/Mara Lindqvist.md')
    expect(idx.backlinkCount('People/Mara Lindqvist.md')).toBe(1)
  })

  it('lets a real filename win over an alias of the same name', () => {
    const idx = index({
      'A.md': '---\naliases: [B]\n---\nx',
      'B.md': 'the real B'
    })
    expect(idx.resolvePath('B')).toBe('B.md')
  })

  it('lists resolvable aliases with their target', () => {
    const idx = index({ 'A.md': '---\nalias: Foo Bar\n---\nx' })
    expect(idx.aliasList()).toEqual([{ alias: 'Foo Bar', path: 'A.md', name: 'A' }])
  })
})

describe('frontmatter relationships', () => {
  it('creates a backlink from a frontmatter property, labelled by the property', () => {
    const idx = index({
      'Books/Chip War.md': '---\nauthor: "[[Chris Miller]]"\n---\nA book.',
      'People/Chris Miller.md': 'An author.'
    })
    const back = idx.backlinksFor('People/Chris Miller.md')
    expect(back).toHaveLength(1)
    expect(back[0].sourcePath).toBe('Books/Chip War.md')
    expect(back[0].context).toBe('author: [[Chris Miller]]')
    expect(back[0].ref.prop).toBe('author')
  })

  it('includes frontmatter relationships in the graph', () => {
    const idx = index({
      'Books/Chip War.md': '---\nauthor: "[[Chris Miller]]"\n---\nx',
      'People/Chris Miller.md': 'x'
    })
    const g = idx.graph()
    expect(g.links).toContainEqual({ source: 'Books/Chip War.md', target: 'People/Chris Miller.md' })
  })
})

describe('withContentChanges (incremental)', () => {
  const patch = (idx: VaultIndex, files: Record<string, string>, changed: Record<string, string>) => {
    const next = { ...files, ...changed }
    const notes = Object.entries(changed).map(([p, t]) => parseNote(p, t))
    return { result: idx.withContentChanges(notes, next), next }
  }

  it('adds a backlink when an edit introduces a link', () => {
    const files = { 'A.md': 'nothing yet', 'B.md': 'x' }
    const idx = index(files)
    expect(idx.backlinkCount('B.md')).toBe(0)
    const { result } = patch(idx, files, { 'A.md': 'now [[B]]' })
    expect(result).not.toBeNull()
    expect(result!.backlinkCount('B.md')).toBe(1)
    expect(result!.backlinksFor('B.md')[0].sourcePath).toBe('A.md')
  })

  it('removes a backlink when an edit drops the link', () => {
    const files = { 'A.md': 'see [[B]]', 'B.md': 'x' }
    const idx = index(files)
    const { result } = patch(idx, files, { 'A.md': 'link gone' })
    expect(result!.backlinkCount('B.md')).toBe(0)
    expect(result!.backlinksFor('B.md')).toHaveLength(0)
  })

  it('matches a full rebuild for the same final state', () => {
    const files = { 'A.md': '[[B]] [[C]]', 'B.md': 'x', 'C.md': '[[B]]' }
    const idx = index(files)
    const { result, next } = patch(idx, files, { 'A.md': '[[C]] only now' })
    const full = index(next)
    for (const p of Object.keys(next)) {
      expect(result!.backlinkCount(p)).toBe(full.backlinkCount(p))
    }
    // The {{query}} block index also reflects the edit.
    expect(result!.query('[[C]]').map((b) => b.path).sort()).toEqual(
      full.query('[[C]]').map((b) => b.path).sort()
    )
  })

  it('refuses to patch a brand-new path (returns null → caller full-rebuilds)', () => {
    const files = { 'A.md': 'x' }
    const idx = index(files)
    const notes = [parseNote('New.md', 'fresh')]
    expect(idx.withContentChanges(notes, { ...files, 'New.md': 'fresh' })).toBeNull()
  })

  it('refuses to patch when a note changes its aliases', () => {
    const files = { 'A.md': '---\naliases: [Foo]\n---\nbody', 'B.md': '[[Foo]]' }
    const idx = index(files)
    const { result } = patch(idx, files, { 'A.md': '---\naliases: [Bar]\n---\nbody' })
    expect(result).toBeNull()
  })
})
