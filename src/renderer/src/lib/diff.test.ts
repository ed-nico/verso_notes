import { describe, it, expect } from 'vitest'
import { diffLines, DIFF_MAX_LINES } from './diff'

describe('diffLines', () => {
  it('reports identical text as all same', () => {
    const r = diffLines('a\nb\nc', 'a\nb\nc')
    expect(r.rows.every((x) => x.kind === 'same')).toBe(true)
    expect(r.sameRatio).toBe(1)
  })

  it('pairs a replaced line into one changed row', () => {
    const r = diffLines('a\nb\nc', 'a\nB\nc')
    expect(r.rows.map((x) => x.kind)).toEqual(['same', 'change', 'same'])
    expect(r.rows[1]).toMatchObject({ a: 'b', b: 'B' })
  })

  it('reports an inserted line as an addition', () => {
    const r = diffLines('a\nc', 'a\nb\nc')
    expect(r.rows.map((x) => x.kind)).toEqual(['same', 'add', 'same'])
    expect(r.rows[1].b).toBe('b')
  })

  it('reports a removed line as a deletion', () => {
    const r = diffLines('a\nb\nc', 'a\nc')
    expect(r.rows.map((x) => x.kind)).toEqual(['same', 'del', 'same'])
    expect(r.rows[1].a).toBe('b')
  })

  it('keeps the common subsequence rather than rewriting everything', () => {
    const r = diffLines('one\ntwo\nthree\nfour', 'one\nthree\nfour\nfive')
    expect(r.rows.filter((x) => x.kind === 'same').map((x) => x.a)).toEqual(['one', 'three', 'four'])
  })

  it('refuses inputs too large to diff instead of hanging', () => {
    const huge = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `line ${i}`).join('\n')
    const r = diffLines(huge, huge)
    expect(r.tooLarge).toBe(true)
    expect(r.rows).toEqual([])
  })
})
