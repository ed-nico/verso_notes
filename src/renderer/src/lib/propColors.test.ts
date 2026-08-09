import { describe, expect, it } from 'vitest'
import { defaultColor, optionColors, renameOption, seedColors, withOptionColors } from './propColors'

describe('optionColors', () => {
  it('reads the per-property map and ignores unknown colours', () => {
    const fm = { _colors: { Sleep: { Good: 'green', Bad: 'red', Odd: 'chartreuse' } } }
    expect(optionColors(fm, 'Sleep')).toEqual({ Good: 'green', Bad: 'red' })
  })

  it('is empty for a property with no colours, and for junk shapes', () => {
    expect(optionColors({}, 'Sleep')).toEqual({})
    expect(optionColors({ _colors: 'nope' }, 'Sleep')).toEqual({})
    expect(optionColors({ _colors: { Sleep: ['green'] } }, 'Sleep')).toEqual({})
  })
})

describe('withOptionColors', () => {
  it('sets one property without disturbing the others', () => {
    const base = { _colors: { Mood: { Up: 'green' } } }
    expect(withOptionColors(base, 'Sleep', { Good: 'green' })._colors).toEqual({
      Mood: { Up: 'green' },
      Sleep: { Good: 'green' }
    })
  })

  it('drops the key when empty, and the whole map when it empties out', () => {
    const one = withOptionColors({ _colors: { Sleep: { Good: 'green' } } }, 'Sleep', {})
    expect(one._colors).toBeUndefined()
    const some = withOptionColors({ _colors: { Mood: { Up: 'green' } } }, 'Sleep', {})
    expect(some._colors).toEqual({ Mood: { Up: 'green' } })
  })
})

describe('defaultColor', () => {
  it('paints the good/average/bad scale from the words themselves', () => {
    expect(defaultColor('Good', 0)).toBe('green')
    expect(defaultColor('average', 1)).toBe('orange')
    expect(defaultColor('Bad', 2)).toBe('red')
  })

  it('cycles the palette for words with no meaning, never landing on gray', () => {
    const cycled = [0, 1, 2, 3].map((i) => defaultColor('Phase ' + i, i))
    expect(new Set(cycled).size).toBe(4)
    expect(cycled).not.toContain('gray')
  })
})

describe('seedColors', () => {
  it('keeps chosen colours, seeds new options, and forgets removed ones', () => {
    const existing = { Good: 'blue' as const, Gone: 'pink' as const }
    expect(seedColors(['Good', 'Bad'], existing)).toEqual({ Good: 'blue', Bad: 'red' })
  })
})

describe('renameOption', () => {
  it('carries the colour to the new name', () => {
    expect(renameOption({ Good: 'green' }, 'Good', 'Great')).toEqual({ Great: 'green' })
  })

  it('is a no-op for an uncoloured or unchanged option', () => {
    expect(renameOption({ Good: 'green' }, 'Bad', 'Poor')).toEqual({ Good: 'green' })
    expect(renameOption({ Good: 'green' }, 'Good', 'Good')).toEqual({ Good: 'green' })
  })
})
