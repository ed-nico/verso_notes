import { describe, it, expect } from 'vitest'
import { searchNotes } from './search'
import type { NoteFile, ParsedNote } from '@shared/types'

const file = (path: string): NoteFile => ({ path, name: path.replace(/.*\//, '').replace(/\.md$/, ''), mtime: 0 })

const files = [file('Chip War.md'), file('Deep Work.md'), file('Taiwan Notes.md')]
const texts: Record<string, string> = {
  'Chip War.md': 'A book about semiconductors and Taiwan.',
  'Deep Work.md': 'Focus and attention.',
  'Taiwan Notes.md': 'Geography of the island.'
}

const paths = (q: string, opts = {}): string[] =>
  searchNotes(q, files, texts, 50, opts).map((h) => h.name)

describe('searchNotes', () => {
  it('matches a filename by substring', () => {
    expect(paths('chip', { fuzzyNames: false })).toContain('Chip War')
  })

  it('fuzzy-matches a filename for the quick switcher', () => {
    // "chipwar" (no space) is a subsequence of "Chip War".
    expect(paths('chipwar')).toContain('Chip War')
  })

  it('requires every space-separated term (order-independent across name + body)', () => {
    // "taiwan" is in Chip War's body; "chip" is in its name → both terms satisfied.
    expect(paths('taiwan chip', { fuzzyNames: false })).toContain('Chip War')
    // A term that appears nowhere excludes the note.
    expect(paths('chip bananas', { fuzzyNames: false })).not.toContain('Chip War')
  })

  it('finds a note by body text and returns a snippet', () => {
    const hit = searchNotes('semiconductors', files, texts, 50, { fuzzyNames: false })[0]
    expect(hit.name).toBe('Chip War')
    expect(hit.inBody).toBe(true)
    expect(hit.snippet).toContain('semiconductors')
  })

  it('matches a note by a frontmatter alias', () => {
    const aliasOf = (p: string): string[] => (p === 'Chip War.md' ? ['Semiconductors Book'] : [])
    expect(paths('semiconductors book', { fuzzyNames: false, aliasOf })).toContain('Chip War')
  })

  it('ranks name matches above body-only matches', () => {
    // "taiwan" is a filename for one note and body text for another.
    const ranked = searchNotes('taiwan', files, texts, 50, { fuzzyNames: false }).map((h) => h.name)
    expect(ranked[0]).toBe('Taiwan Notes')
  })
})

describe('searchNotes with pre-parsed notes', () => {
  const parsedNote = (path: string, aliases: string[] = []): ParsedNote => ({
    path,
    name: path.replace(/.*\//, '').replace(/\.md$/, ''),
    frontmatter: {},
    links: [],
    aliases,
    tags: [],
    excerpt: ''
  })
  const parsed: Record<string, ParsedNote> = {
    'Chip War.md': parsedNote('Chip War.md', ['Miller Book']),
    'Deep Work.md': parsedNote('Deep Work.md'),
    'Taiwan Notes.md': parsedNote('Taiwan Notes.md')
  }
  const fmTexts: Record<string, string> = {
    ...texts,
    'Chip War.md': '---\ntitle: Chip War\n---\n\nA book about semiconductors and Taiwan.'
  }

  it('returns the same body hits without re-parsing YAML', () => {
    const hit = searchNotes('semiconductors', files, fmTexts, 50, { fuzzyNames: false, parsed })[0]
    expect(hit.name).toBe('Chip War')
    expect(hit.inBody).toBe(true)
    expect(hit.snippet).toContain('semiconductors')
  })

  it('does not match text that only appears in frontmatter', () => {
    // "title" is only in the YAML block, which is stripped either way.
    expect(searchNotes('title', files, fmTexts, 50, { fuzzyNames: false, parsed })).toHaveLength(0)
    expect(searchNotes('title', files, fmTexts, 50, { fuzzyNames: false })).toHaveLength(0)
  })

  it('uses aliases from the parsed notes when no aliasOf is given', () => {
    const names = searchNotes('miller book', files, fmTexts, 50, { fuzzyNames: false, parsed }).map(
      (h) => h.name
    )
    expect(names).toContain('Chip War')
  })

  it('falls back to full parsing when parsed is absent', () => {
    const hit = searchNotes('semiconductors', files, fmTexts, 50, { fuzzyNames: false })[0]
    expect(hit.name).toBe('Chip War')
  })
})
