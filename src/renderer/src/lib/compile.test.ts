import { describe, it, expect } from 'vitest'
import { compileNote, joinSections } from './compile'
import { parseNote } from './parse'
import { resolveTarget } from './links'
import type { ParsedNote } from '@shared/types'

/** Build texts/parsed/resolve from a { path: text } map. */
function vault(notes: Record<string, string>): {
  texts: Record<string, string>
  parsed: Record<string, ParsedNote>
  resolve: (raw: string) => string | null
} {
  const parsed: Record<string, ParsedNote> = {}
  for (const [p, t] of Object.entries(notes)) parsed[p] = parseNote(p, t)
  const paths = Object.keys(notes)
  return { texts: notes, parsed, resolve: (raw) => resolveTarget(raw, paths) }
}

describe('compileNote', () => {
  it('walks links depth-first in reading order, including each note once', () => {
    const { texts, parsed, resolve } = vault({
      'Hub.md': 'Start with [[Alpha]] then [[Beta]].',
      'Alpha.md': 'Alpha links [[Gamma]] and back to [[Hub]].',
      'Beta.md': 'Beta also cites [[Gamma]].',
      'Gamma.md': 'Leaf.'
    })
    const sections = compileNote('Hub.md', texts, parsed, resolve)
    expect(sections.map((s) => s.path)).toEqual(['Hub.md', 'Alpha.md', 'Gamma.md', 'Beta.md'])
    expect(sections.map((s) => s.depth)).toEqual([0, 1, 2, 1])
  })

  it('survives link cycles', () => {
    const { texts, parsed, resolve } = vault({
      'A.md': 'to [[B]]',
      'B.md': 'back to [[A]]'
    })
    const sections = compileNote('A.md', texts, parsed, resolve)
    expect(sections.map((s) => s.path)).toEqual(['A.md', 'B.md'])
  })

  it('respects maxDepth and maxNotes', () => {
    const { texts, parsed, resolve } = vault({
      'A.md': 'to [[B]]',
      'B.md': 'to [[C]]',
      'C.md': 'deep'
    })
    expect(compileNote('A.md', texts, parsed, resolve, { maxDepth: 1 }).map((s) => s.path)).toEqual([
      'A.md',
      'B.md'
    ])
    expect(compileNote('A.md', texts, parsed, resolve, { maxNotes: 2 })).toHaveLength(2)
  })

  it('skips frontmatter relationship links', () => {
    const { texts, parsed, resolve } = vault({
      'Book.md': '---\nauthor: "[[Mara]]"\n---\nAbout the book. See [[Notes]].',
      'Mara.md': 'A person.',
      'Notes.md': 'Reading notes.'
    })
    const sections = compileNote('Book.md', texts, parsed, resolve)
    expect(sections.map((s) => s.path)).toEqual(['Book.md', 'Notes.md'])
  })

  it('titles each section by depth and demotes body headings beneath it', () => {
    const { texts, parsed, resolve } = vault({
      'Hub.md': '# Intro\n\nSee [[Child]].',
      'Child.md': '# Part\n\n```\n# not a heading\n```'
    })
    const [hub, child] = compileNote('Hub.md', texts, parsed, resolve)
    expect(hub.markdown).toContain('# Hub\n')
    expect(hub.markdown).toContain('\n## Intro') // body heading demoted below the title
    expect(child.markdown).toContain('## Child')
    expect(child.markdown).toContain('### Part')
    expect(child.markdown).toContain('# not a heading') // fenced code untouched
  })

  it('strips frontmatter and ^block anchors from section bodies', () => {
    const { texts, parsed, resolve } = vault({
      'A.md': '---\ntags: [x]\n---\nA line ^abc123\nplain'
    })
    const [a] = compileNote('A.md', texts, parsed, resolve)
    expect(a.markdown).not.toContain('tags:')
    expect(a.markdown).not.toContain('^abc123')
    expect(a.markdown).toContain('A line\nplain')
  })

  it('flattens wikilinks to display text when asked, leaving embeds and code alone', () => {
    const { texts, parsed, resolve } = vault({
      'A.md': 'See [[Deep/Note|the note]] and [[Other#sec]].\n![[img.png]]\n`[[not a link]]`'
    })
    const [a] = compileNote('A.md', texts, parsed, resolve, { flattenLinks: true })
    expect(a.markdown).toContain('See the note and Other.')
    expect(a.markdown).toContain('![[img.png]]')
    expect(a.markdown).toContain('`[[not a link]]`')
  })
})

describe('joinSections', () => {
  it('joins kept sections and honours exclusions', () => {
    const { texts, parsed, resolve } = vault({
      'A.md': 'to [[B]] and [[C]]',
      'B.md': 'bee',
      'C.md': 'sea'
    })
    const sections = compileNote('A.md', texts, parsed, resolve)
    const md = joinSections(sections, new Set(['B.md']))
    expect(md).toContain('# A')
    expect(md).toContain('## C')
    expect(md).not.toContain('## B')
  })
})
