import { describe, it, expect } from 'vitest'
import { parseNote, contextForLink } from './parse'

describe('parseNote links', () => {
  it('extracts wikilinks with aliases', () => {
    const n = parseNote('A.md', 'see [[Foo]] and [[Bar|baz]]')
    expect(n.links.map((l) => l.raw)).toEqual(['Foo', 'Bar'])
    expect(n.links[1].alias).toBe('baz')
  })

  it('normalizes an empty alias to undefined', () => {
    const n = parseNote('A.md', '[[Foo|]]')
    expect(n.links[0].alias).toBeUndefined()
  })

  it('ignores wikilinks inside inline code and fenced blocks', () => {
    const inline = parseNote('A.md', 'text `[[NotALink]]` more')
    expect(inline.links.length).toBe(0)
    const fenced = parseNote('A.md', '```\n[[AlsoNot]]\n```\n[[Real]]')
    expect(fenced.links.map((l) => l.raw)).toEqual(['Real'])
  })
})

describe('parseNote frontmatter relationships', () => {
  it('extracts [[wikilinks]] from frontmatter values, tagged with their property', () => {
    const n = parseNote('Book.md', '---\nauthor: "[[Chris Miller]]"\ntopics: ["[[Trade]]", "[[Chips]]"]\n---\nbody [[Body Link]]')
    const fm = n.links.filter((l) => l.prop)
    expect(fm.map((l) => `${l.prop}:${l.raw}`)).toEqual(['author:Chris Miller', 'topics:Trade', 'topics:Chips'])
    // Body links remain unlabelled.
    expect(n.links.find((l) => l.raw === 'Body Link')?.prop).toBeUndefined()
  })

  it('does not treat aliases or tags as relationships', () => {
    const n = parseNote('A.md', '---\naliases: ["[[NotALink]]"]\ntags: [work]\n---\nx')
    expect(n.links.filter((l) => l.prop)).toHaveLength(0)
    expect(n.aliases).toEqual(['NotALink'])
  })
})

describe('parseNote aliases', () => {
  it('reads a YAML list and a singular comma string', () => {
    expect(parseNote('A.md', '---\naliases: [Foo, Bar Baz]\n---\nx').aliases).toEqual(['Foo', 'Bar Baz'])
    expect(parseNote('A.md', '---\nalias: One, Two\n---\nx').aliases).toEqual(['One', 'Two'])
  })
})

describe('parseNote tags', () => {
  it('extracts inline tags including nested slugs', () => {
    const n = parseNote('A.md', 'hello #world and #foo/bar')
    expect(n.tags).toContain('world')
    expect(n.tags).toContain('foo/bar')
  })

  it('does not treat a markdown heading as a tag', () => {
    const n = parseNote('A.md', '# Heading\n\nbody')
    expect(n.tags).not.toContain('Heading')
  })

  it('merges frontmatter tags case-insensitively', () => {
    const n = parseNote('A.md', '---\ntags: [Work]\n---\n\n#work again')
    const lowered = n.tags.map((t) => t.toLowerCase())
    expect(lowered.filter((t) => t === 'work')).toHaveLength(1)
  })

  it('does not treat all-digit tokens as tags', () => {
    const n = parseNote('A.md', 'shipped in #2024 and #123')
    expect(n.tags).toHaveLength(0)
  })

  it('accepts tags that mix digits with at least one letter', () => {
    const n = parseNote('A.md', 'plan #2024-goals and #y2024/q1 and #a1')
    expect(n.tags).toContain('2024-goals')
    expect(n.tags).toContain('y2024/q1')
    expect(n.tags).toContain('a1')
  })

  it('ignores tags inside code', () => {
    const n = parseNote('A.md', 'use `#notatag` here\n```\n#alsonot\n```\n#real')
    expect(n.tags).toEqual(['real'])
  })
})

describe('parseNote excerpt + name', () => {
  it('uses the first meaningful body line and derives the name', () => {
    const n = parseNote('Folder/My Note.md', '# Title\n\nThe **first** real line.')
    expect(n.name).toBe('My Note')
    expect(n.excerpt).toContain('first')
  })
})

describe('contextForLink', () => {
  it('finds the line containing a link to the page', () => {
    const text = 'intro\nhere is [[Target]] inline\noutro'
    const ctx = contextForLink(text, 'Target')
    expect(ctx.text).toContain('[[Target]]')
    expect(ctx.line).toBe(1)
  })
  it('returns line -1 when not found', () => {
    expect(contextForLink('no links here', 'Target').line).toBe(-1)
  })
})
