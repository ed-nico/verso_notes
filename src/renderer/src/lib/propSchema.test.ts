import { describe, expect, it } from 'vitest'
import { vaultPropSchemas, withOptions } from './propSchema'

const note = (path: string, frontmatter: Record<string, unknown>): { path: string; frontmatter: Record<string, unknown> } => ({
  path,
  frontmatter
})

const SCHEMA_NOTE = note('Meta/Property Schemas.md', {
  _options: { Sleep: ['Good', 'Average', 'Bad'] },
  _colors: { Sleep: { Good: 'green', Average: 'orange', Bad: 'red' } }
})

describe('vaultPropSchemas', () => {
  it('lets one note define a property a thousand others merely use', () => {
    const s = vaultPropSchemas([SCHEMA_NOTE, note('Daily/2026-08-05.md', { Sleep: 'Good' })])
    expect(s.Sleep.options).toEqual(['Good', 'Average', 'Bad'])
    expect(s.Sleep.colors).toEqual({ Good: 'green', Average: 'orange', Bad: 'red' })
    expect(s.Sleep.from).toBe('Meta/Property Schemas.md')
  })

  it('resolves competing definitions by path, not by iteration order', () => {
    const a = note('A.md', { _options: { Status: ['Open'] } })
    const b = note('B.md', { _options: { Status: ['Closed'] } })
    expect(vaultPropSchemas([a, b]).Status.from).toBe('A.md')
    expect(vaultPropSchemas([b, a]).Status.from).toBe('A.md')
  })

  it('ignores `_types` — a per-note type must not retype the whole vault', () => {
    const s = vaultPropSchemas([note('A.md', { _types: { Status: 'date' }, Status: '2026-08-05' })])
    expect(s.Status).toBeUndefined()
  })

  it('ignores empty and malformed option lists', () => {
    const s = vaultPropSchemas([
      note('A.md', { _options: { Empty: [], Junk: 'nope' } }),
      note('B.md', { _options: 'nope' })
    ])
    expect(s).toEqual({})
  })
})

describe('withOptions', () => {
  it('sets and clears one property, dropping the map when it empties', () => {
    const set = withOptions({}, 'Sleep', ['Good'])
    expect(set._options).toEqual({ Sleep: ['Good'] })
    expect(withOptions(set, 'Sleep', [])._options).toBeUndefined()
    expect(withOptions({ _options: { Mood: ['Up'] } }, 'Sleep', [])._options).toEqual({ Mood: ['Up'] })
  })
})
