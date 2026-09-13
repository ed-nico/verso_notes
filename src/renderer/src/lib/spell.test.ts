import { describe, it, expect, beforeEach } from 'vitest'
import { spellable, setVaultWords } from './spell'

beforeEach(() => setVaultWords([]))

describe('spellable', () => {
  it('checks ordinary words, including contractions', () => {
    expect(spellable('sentence')).toBe(true)
    expect(spellable("don't")).toBe(true)
  })

  it('skips things a dictionary has no business judging', () => {
    expect(spellable('at')).toBe(false) // shorter than the floor
    expect(spellable('DFSA')).toBe(false) // acronym
    expect(spellable('useState')).toBe(false) // identifier
    expect(spellable('readNotesCached')).toBe(false)
    expect(spellable('v2')).toBe(false) // has a digit
    expect(spellable('')).toBe(false)
  })

  it('treats a capitalised word as prose, not an identifier', () => {
    expect(spellable('London')).toBe(true)
  })
})

describe('vault vocabulary', () => {
  it('accepts words the vault already uses as note names or tags', () => {
    expect(spellable('Khaleeji')).toBe(true)
    setVaultWords(['Khaleeji', 'DFSA Handbook', 'arabic-learning'])
    expect(spellable('Khaleeji')).toBe(false) // now a known word
    expect(spellable('khaleeji')).toBe(false) // case-insensitive
    expect(spellable('Handbook')).toBe(false) // multi-word names are split
    expect(spellable('learning')).toBe(false) // so are hyphenated tags
    expect(spellable('sentance')).toBe(true) // an actual typo still checks
  })

  it('ignores tokens too short to be worth whitelisting', () => {
    setVaultWords(['a b of'])
    expect(spellable('off')).toBe(true)
  })
})
