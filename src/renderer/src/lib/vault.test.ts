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

describe('unlinkedReferences hardening (2026-07 audit)', () => {
  it('does not count a #tag carrying the name as a mention', () => {
    const idx = index({
      'Project.md': 'home',
      'A.md': 'working on #Project today'
    })
    expect(idx.unlinkedReferences('Project.md')).toHaveLength(0)
  })

  it('does not count mentions inside fenced or inline code', () => {
    const idx = index({
      'Project.md': 'home',
      'A.md': '```\nProject in code\n```\nand `Project` inline',
      'B.md': 'real Project mention'
    })
    const sources = idx.unlinkedReferences('Project.md').map((r) => r.sourcePath)
    expect(sources).toEqual(['B.md'])
  })

  it('does not count frontmatter values as mentions', () => {
    const idx = index({
      'Project.md': 'home',
      'A.md': '---\ntitle: Project\n---\nnothing here'
    })
    expect(idx.unlinkedReferences('Project.md')).toHaveLength(0)
  })

  it('reports full-text line numbers (frontmatter offset applied)', () => {
    const idx = index({
      'Project.md': 'home',
      'A.md': '---\ntitle: x\n---\n\nabout Project here'
    })
    const refs = idx.unlinkedReferences('Project.md')
    expect(refs).toHaveLength(1)
    expect(refs[0].line).toBe(4) // full-text index of the mention line
  })
})

describe('backlink context per occurrence', () => {
  it('gives each backlink row its own line when a source links twice', () => {
    const idx = index({
      'B.md': 'x',
      'A.md': 'first [[B]]\nsecond [[B]] here'
    })
    const back = idx.backlinksFor('B.md')
    expect(back).toHaveLength(2)
    // Context is now the whole paragraph unit, but each row jumps to ITS line.
    expect(back[0].context).toContain('first [[B]]')
    expect(back[1].context).toContain('second [[B]] here')
    expect(back[0].line).not.toBe(back[1].line)
  })

  it('skips code when finding context', () => {
    const idx = index({
      'B.md': 'x',
      'A.md': '```\n[[B]]\n```\nreal [[B]] here'
    })
    const back = idx.backlinksFor('B.md')
    expect(back).toHaveLength(1)
    expect(back[0].context).toContain('real [[B]] here')
    expect(back[0].context).not.toContain('```') // fences bound the paragraph unit
  })
})

describe('graph asset embeds', () => {
  it('does not create phantom nodes for image/pdf embeds', () => {
    const idx = index({ 'A.md': '![[photo.png]] and [[Missing Note]] and [[doc.pdf]]' })
    const g = idx.graph()
    const phantoms = g.nodes.filter((n) => n.phantom).map((n) => n.name)
    expect(phantoms).toEqual(['Missing Note'])
  })
})

describe('block-level backlink context (Reflect round)', () => {
  it('includes a list item children and its parent line', () => {
    const idx = index({
      'B.md': 'x',
      'A.md': '- project\n  - talk to [[B]] tomorrow\n    - bring the doc\n- other'
    })
    const ctx = idx.backlinksFor('B.md')[0].context
    expect(ctx).toContain('project') // parent line for orientation
    expect(ctx).toContain('talk to [[B]] tomorrow')
    expect(ctx).toContain('bring the doc') // child came along
    expect(ctx).not.toContain('other') // sibling of the parent stays out
  })

  it('returns the whole paragraph, not one line', () => {
    const idx = index({
      'B.md': 'x',
      'A.md': 'First sentence.\nThen we mention [[B]] here.\nAnd conclude.\n\nNext para.'
    })
    const ctx = idx.backlinksFor('B.md')[0].context
    expect(ctx).toContain('First sentence.')
    expect(ctx).toContain('And conclude.')
    expect(ctx).not.toContain('Next para.')
  })

  it('caps very long units with an ellipsis', () => {
    const long = ['- head [[B]]', ...Array.from({ length: 12 }, (_, i) => `  - child ${i}`)].join('\n')
    const idx = index({ 'B.md': 'x', 'A.md': long })
    const ctx = idx.backlinksFor('B.md')[0].context
    expect(ctx.split('\n').length).toBeLessThanOrEqual(7)
    expect(ctx).toContain('…')
  })
})

// ---------------------------------------------------------------------------
// Incremental patching: the shared-state contract of withContentChanges, and the
// combined-scan rewrite of unlinkedReferences.
// ---------------------------------------------------------------------------

describe('withContentChanges: shared-state contract', () => {
  it('returns a fresh handle so subscribers see a changed identity', () => {
    const files = { 'A.md': 'hello', 'B.md': 'x' }
    const idx = index(files)
    files['A.md'] = 'hello [[B]]'
    const next = idx.withContentChanges([parseNote('A.md', files['A.md'])], files)
    expect(next).not.toBeNull()
    expect(next).not.toBe(idx)
  })

  it('bumps the version on both handles, since they share state', () => {
    const files = { 'A.md': 'hello', 'B.md': 'x' }
    const idx = index(files)
    expect(idx.version).toBe(0)
    files['A.md'] = 'hello [[B]]'
    const next = idx.withContentChanges([parseNote('A.md', files['A.md'])], files)!
    expect(next.version).toBe(1)
    expect(idx.version).toBe(1) // superseded, not preserved
  })

  it('leaves no cache that one handle refreshes and the other does not', () => {
    // The old implementation cloned FIRST and then mutated a mix of `this` and the
    // clone, so the previous handle kept a stale unlinked-reference memo while
    // everything else about it had moved on. Both handles must now agree.
    const files: Record<string, string> = { 'Alpha.md': 'x', 'B.md': 'nothing here' }
    const idx = index(files)
    expect(idx.unlinkedReferences('Alpha.md')).toHaveLength(0) // populates the memo

    files['B.md'] = 'now mentions Alpha in prose'
    const next = idx.withContentChanges([parseNote('B.md', files['B.md'])], files)!

    expect(next.unlinkedReferences('Alpha.md')).toHaveLength(1)
    expect(idx.unlinkedReferences('Alpha.md')).toHaveLength(1)
  })

  it('patches backlinks for an edited note without a full rebuild', () => {
    const files: Record<string, string> = { 'A.md': 'plain', 'B.md': 'x' }
    const idx = index(files)
    expect(idx.backlinkCount('B.md')).toBe(0)
    files['A.md'] = 'now links [[B]]'
    const next = idx.withContentChanges([parseNote('A.md', files['A.md'])], files)!
    expect(next.backlinkCount('B.md')).toBe(1)
  })

  it('drops backlinks when an edit removes the link', () => {
    const files: Record<string, string> = { 'A.md': 'links [[B]]', 'B.md': 'x' }
    const idx = index(files)
    expect(idx.backlinkCount('B.md')).toBe(1)
    files['A.md'] = 'link removed'
    const next = idx.withContentChanges([parseNote('A.md', files['A.md'])], files)!
    expect(next.backlinkCount('B.md')).toBe(0)
    expect(next.backlinksFor('B.md')).toHaveLength(0)
  })

  it('refuses to patch an unknown path (the file set changed)', () => {
    const files: Record<string, string> = { 'A.md': 'x' }
    const idx = index(files)
    files['New.md'] = 'brand new'
    expect(idx.withContentChanges([parseNote('New.md', files['New.md'])], files)).toBeNull()
  })

  it('refuses to patch when aliases changed (resolution may shift vault-wide)', () => {
    const files: Record<string, string> = { 'A.md': 'x', 'B.md': 'y' }
    const idx = index(files)
    files['A.md'] = '---\naliases: [Ay]\n---\nx'
    expect(idx.withContentChanges([parseNote('A.md', files['A.md'])], files)).toBeNull()
  })

  it('re-scans only the edited note for mentions, keeping other sources intact', () => {
    const files: Record<string, string> = {
      'Alpha.md': 'target',
      'B.md': 'B talks about Alpha',
      'C.md': 'C talks about Alpha'
    }
    const idx = index(files)
    expect(idx.unlinkedReferences('Alpha.md').map((r) => r.sourcePath).sort()).toEqual(['B.md', 'C.md'])

    files['B.md'] = 'B no longer says the word'
    const next = idx.withContentChanges([parseNote('B.md', files['B.md'])], files)!
    expect(next.unlinkedReferences('Alpha.md').map((r) => r.sourcePath)).toEqual(['C.md'])
  })
})

describe('unlinkedReferences: combined scan', () => {
  it('finds mentions of several different notes in one source', () => {
    const idx = index({
      'Alpha.md': 'a',
      'Beta.md': 'b',
      'Notes.md': 'Discussed Alpha and Beta today.'
    })
    expect(idx.unlinkedReferences('Alpha.md').map((r) => r.sourcePath)).toEqual(['Notes.md'])
    expect(idx.unlinkedReferences('Beta.md').map((r) => r.sourcePath)).toEqual(['Notes.md'])
  })

  it('matches back-to-back mentions (the boundary is a lookahead, not a consumed char)', () => {
    const idx = index({ 'Alpha.md': 'a', 'Beta.md': 'b', 'N.md': 'Alpha Beta' })
    expect(idx.unlinkedReferences('Alpha.md')).toHaveLength(1)
    expect(idx.unlinkedReferences('Beta.md')).toHaveLength(1)
  })

  it('prefers the longest name when one is a suffix of another', () => {
    const idx = index({ 'Work.md': 'w', 'Deep Work.md': 'd', 'N.md': 'I do Deep Work daily' })
    expect(idx.unlinkedReferences('Deep Work.md')).toHaveLength(1)
    expect(idx.unlinkedReferences('Work.md')).toHaveLength(0)
  })

  it('emits one row per line even when a name repeats on it', () => {
    const idx = index({ 'Alpha.md': 'a', 'N.md': 'Alpha and Alpha again' })
    expect(idx.unlinkedReferences('Alpha.md')).toHaveLength(1)
  })

  it('reports every note sharing a duplicated basename', () => {
    const idx = index({ 'One/Dup.md': 'x', 'Two/Dup.md': 'y', 'N.md': 'mentions Dup here' })
    expect(idx.unlinkedReferences('One/Dup.md')).toHaveLength(1)
    expect(idx.unlinkedReferences('Two/Dup.md')).toHaveLength(1)
  })

  it('never reports a note mentioning its own name', () => {
    const idx = index({ 'Alpha.md': 'Alpha is the subject of Alpha' })
    expect(idx.unlinkedReferences('Alpha.md')).toHaveLength(0)
  })

  it('returns [] for a path that is not a note', () => {
    expect(index({ 'A.md': 'x' }).unlinkedReferences('Nope.md')).toEqual([])
  })

  it('survives a note whose name contains regex metacharacters', () => {
    const idx = index({ 'C++ (notes).md': 'x', 'N.md': 'read C++ (notes) today' })
    expect(idx.unlinkedReferences('C++ (notes).md')).toHaveLength(1)
  })
})
