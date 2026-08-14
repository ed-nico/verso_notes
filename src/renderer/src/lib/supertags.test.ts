import { describe, it, expect } from 'vitest'
import {
  buildSupertagIndex,
  fieldsForNote,
  fieldsToFrontmatter,
  isSupertagDef,
  isSupertagSchemaKey,
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

describe('supertag definition notes', () => {
  it('recognises a definition note by folder', () => {
    expect(isSupertagDef('Tags/Person.md')).toBe(true)
    expect(isSupertagDef('Notes/Person.md')).toBe(false)
    // Not a Tags/ note despite the prefix.
    expect(isSupertagDef('Tagsmith/Person.md')).toBe(false)
  })

  // `fields` is a nested map: shown as a generic property row it renders as
  // "[object Object]", which is what users saw on a newly created supertag.
  it('hides schema keys from the properties panel, only on definition notes', () => {
    expect(isSupertagSchemaKey('Tags/Person.md', 'fields')).toBe(true)
    expect(isSupertagSchemaKey('Tags/Person.md', 'extends')).toBe(true)
    expect(isSupertagSchemaKey('Tags/Person.md', 'email')).toBe(false)
    // An ordinary note may legitimately have a property called "fields".
    expect(isSupertagSchemaKey('Notes/Survey.md', 'fields')).toBe(false)
  })

  it('defines a supertag with no instances and no declared fields', () => {
    // What createSupertag writes. It must still register as a supertag, or it
    // can never be found to give it a schema.
    const st = supertagsFromParsed({
      'Tags/Person.md': parseNote('Tags/Person.md', '---\nfields: {}\n---\n')
    })
    expect(st).toHaveLength(1)
    expect(st[0].tag).toBe('person')
    expect(st[0].fields).toEqual([])
  })
})
