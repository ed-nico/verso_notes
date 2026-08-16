import { describe, it, expect } from 'vitest'
import { duplicatePairs } from './similar'
import { clearSimilarCache } from './similar'

/** Enough distinct terms that a note clears the "too short to judge" floor. */
const body = (extra = ''): string =>
  `Deliberate practice requires focused attention sustained repetition immediate feedback and
   gradual increases in difficulty across long horizons ${extra}`

describe('duplicatePairs', () => {
  it('finds notes that say the same thing', () => {
    clearSimilarCache()
    const pairs = duplicatePairs({
      'A.md': body(),
      'A copy.md': body(),
      'Unrelated.md':
        'Sourdough starter hydration percentages autolyse bulk fermentation shaping and scoring bread loaves overnight'
    })
    expect(pairs).toHaveLength(1)
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(['A copy.md', 'A.md'])
    expect(pairs[0].score).toBeGreaterThan(0.9)
  })

  it('does not report notes that merely share a topic', () => {
    clearSimilarCache()
    const pairs = duplicatePairs({
      'One.md': body('plus a paragraph about spacing intervals and recall testing methods'),
      'Two.md':
        'Sourdough starter hydration percentages autolyse bulk fermentation shaping scoring bread loaves overnight proofing',
      'Three.md': 'Short note'
    })
    expect(pairs).toHaveLength(0)
  })

  it('honours the skip predicate', () => {
    clearSimilarCache()
    const texts = { 'Daily/a.md': body(), 'Daily/b.md': body() }
    expect(duplicatePairs(texts)).toHaveLength(1)
    clearSimilarCache()
    expect(duplicatePairs(texts, { skip: (p) => p.startsWith('Daily/') })).toHaveLength(0)
  })

  it('scores each pair once even when several terms propose it', () => {
    clearSimilarCache()
    const pairs = duplicatePairs({ 'X.md': body(), 'Y.md': body(), 'Z.md': body() })
    // 3 mutually-identical notes = 3 unordered pairs, not 3 x probe-terms.
    expect(pairs).toHaveLength(3)
  })
})
