import { describe, it, expect } from 'vitest'
import { newBase, normalizeBases, passesFilter, type Filter } from './bases'

const f = (op: Filter['op'], value = '', key = 'k'): Filter => ({ key, op, value })

describe('passesFilter: exists / empty', () => {
  it('exists is true for any non-empty value', () => {
    expect(passesFilter('x', f('exists'))).toBe(true)
    expect(passesFilter(0, f('exists'))).toBe(true)
    expect(passesFilter(false, f('exists'))).toBe(true)
    expect(passesFilter(['a'], f('exists'))).toBe(true)
  })
  it('exists is false for undefined, null and empty string', () => {
    expect(passesFilter(undefined, f('exists'))).toBe(false)
    expect(passesFilter(null, f('exists'))).toBe(false)
    expect(passesFilter('', f('exists'))).toBe(false)
  })
  it('empty is the inverse', () => {
    expect(passesFilter(undefined, f('empty'))).toBe(true)
    expect(passesFilter('', f('empty'))).toBe(true)
    expect(passesFilter('x', f('empty'))).toBe(false)
    expect(passesFilter(0, f('empty'))).toBe(false)
  })
})

describe('passesFilter: contains / is / is not', () => {
  it('contains is a case-insensitive substring test', () => {
    expect(passesFilter('Deep Work', f('contains', 'work'))).toBe(true)
    expect(passesFilter('Deep Work', f('contains', 'WORK'))).toBe(true)
    expect(passesFilter('Deep Work', f('contains', 'rest'))).toBe(false)
  })
  it('is / is not compare case-insensitively', () => {
    expect(passesFilter('Reading', f('is', 'reading'))).toBe(true)
    expect(passesFilter('Reading', f('is', 'read'))).toBe(false)
    expect(passesFilter('Reading', f('is not', 'done'))).toBe(true)
    expect(passesFilter('Reading', f('is not', 'reading'))).toBe(false)
  })
  it('filter values are trimmed', () => {
    expect(passesFilter('done', f('is', '  done  '))).toBe(true)
  })
  it('list values are joined for string ops', () => {
    // String(['a','b']) === 'a,b'
    expect(passesFilter(['chips', 'trade'], f('contains', 'trade'))).toBe(true)
    expect(passesFilter(['chips', 'trade'], f('is', 'chips,trade'))).toBe(true)
  })
})

describe('passesFilter: ordered comparisons', () => {
  it('compares numerically when both sides parse as numbers', () => {
    expect(passesFilter(9, f('>', '10'))).toBe(false) // 9 < 10 numerically, not lexicographic
    expect(passesFilter(11, f('>', '10'))).toBe(true)
    expect(passesFilter('9', f('<', '10'))).toBe(true)
    expect(passesFilter(4, f('>=', '4'))).toBe(true)
    expect(passesFilter(4, f('<=', '3'))).toBe(false)
  })
  it('compares lexicographically otherwise (ISO dates sort correctly)', () => {
    expect(passesFilter('2026-02-01', f('>', '2026-01-15'))).toBe(true)
    expect(passesFilter('2026-01-01', f('<', '2026-01-15'))).toBe(true)
    expect(passesFilter('banana', f('>', 'apple'))).toBe(true)
  })
  it('an empty cell is not treated as the number 0', () => {
    // Number('') === 0, but the guard requires a non-empty string.
    expect(passesFilter('', f('<', '5'))).toBe(true) // '' < '5' lexicographically
    expect(passesFilter('', f('>', '5'))).toBe(false)
  })
  it('mixed numeric/non-numeric falls back to string comparison', () => {
    expect(passesFilter('abc', f('>', '10'))).toBe(true) // 'abc' > '10' as strings
  })
})

describe('normalizeBases', () => {
  it('returns [] for non-arrays', () => {
    expect(normalizeBases(null)).toEqual([])
    expect(normalizeBases('x')).toEqual([])
    expect(normalizeBases(undefined)).toEqual([])
  })
  it('backfills fields added over time', () => {
    const [b] = normalizeBases([{ id: 'a', name: 'A' }])
    expect(b.filters).toEqual([])
    expect(b.layout).toBe('table')
    expect(b.groupKey).toBe('')
    expect(b.aggregates).toEqual({})
  })
  it('keeps explicit values over the backfill defaults', () => {
    const [b] = normalizeBases([{ id: 'a', name: 'A', layout: 'gallery' }])
    expect(b.layout).toBe('gallery')
  })
})

describe('newBase', () => {
  it('creates a table base with default columns and sane defaults', () => {
    const b = newBase('My Base')
    expect(b.name).toBe('My Base')
    expect(b.columns).toEqual(['name', 'tags', 'backlinks'])
    expect(b.layout).toBe('table')
    expect(b.sortKey).toBe('name')
    expect(b.id).toBeTruthy()
  })
})
