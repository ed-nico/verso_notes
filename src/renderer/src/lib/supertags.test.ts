import { describe, it, expect } from 'vitest'
import {
  buildSupertagIndex,
  fieldsForNote,
  fieldsToFrontmatter,
  resolveFields,
  supertagsForNote,
  supertagsFromParsed
} from './supertags'
import { parseNote } from './parse'

function indexFrom(files: Record<string, string>): ReturnType<typeof buildSupertagIndex> {
  const parsed = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, parseNote(p, t)]))
  return buildSupertagIndex(supertagsFromParsed(parsed))
}

describe('supertagsFromParsed', () => {
  it('reads supertag definitions from Tags/ notes', () => {
    const idx = indexFrom({
      'Tags/Person.md': '---\nfields:\n  role: text\n  company: link\n---\n# Person'
    })
    const st = idx.get('person')
    expect(st?.name).toBe('Person')
    expect(st?.fields.map((f) => f.name)).toEqual(['role', 'company'])
    expect(st?.fields.find((f) => f.name === 'company')?.type).toBe('link')
  })

  it('ignores notes outside Tags/', () => {
    const idx = indexFrom({ 'People/Person.md': '---\nfields:\n  role: text\n---\n' })
    expect(idx.has('person')).toBe(false)
  })

  it('parses select fields with options', () => {
    const idx = indexFrom({
      'Tags/Lead.md': '---\nfields:\n  status: { type: select, options: [active, lead] }\n---\n'
    })
    const f = idx.get('lead')?.fields[0]
    expect(f?.type).toBe('select')
    expect(f?.options).toEqual(['active', 'lead'])
  })
})

describe('resolveFields (inheritance)', () => {
  it('merges parent fields, child overrides win', () => {
    const idx = indexFrom({
      'Tags/Contact.md': '---\nfields:\n  email: text\n  company: text\n---\n',
      'Tags/Person.md': '---\nextends: [Contact]\nfields:\n  company: link\n  role: text\n---\n'
    })
    const fields = resolveFields('person', idx)
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.type]))
    expect(byName).toMatchObject({ email: 'text', company: 'link', role: 'text' })
  })

  it('tolerates an extends cycle', () => {
    const idx = indexFrom({
      'Tags/A.md': '---\nextends: [B]\nfields:\n  a: text\n---\n',
      'Tags/B.md': '---\nextends: [A]\nfields:\n  b: text\n---\n'
    })
    const names = resolveFields('a', idx).map((f) => f.name).sort()
    expect(names).toEqual(['a', 'b'])
  })
})

describe('supertagsForNote / fieldsForNote', () => {
  const idx = indexFrom({
    'Tags/Person.md': '---\nfields:\n  role: text\n---\n',
    'Tags/Meeting.md': '---\nfields:\n  date: date\n---\n'
  })
  it('matches a note carrying the tag (case-insensitive)', () => {
    expect(supertagsForNote(['Person'], idx).map((s) => s.tag)).toEqual(['person'])
  })
  it('unions fields across multiple supertags', () => {
    const names = fieldsForNote(['person', 'meeting'], idx).map((f) => f.name).sort()
    expect(names).toEqual(['date', 'role'])
  })
})

describe('fieldsToFrontmatter', () => {
  it('round-trips bare types and select options', () => {
    expect(
      fieldsToFrontmatter([
        { name: 'role', type: 'text' },
        { name: 'status', type: 'select', options: ['a', 'b'] }
      ])
    ).toEqual({ role: 'text', status: { type: 'select', options: ['a', 'b'] } })
  })
})
