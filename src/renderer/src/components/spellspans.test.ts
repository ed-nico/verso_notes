import { describe, it, expect, beforeEach } from 'vitest'
import { candidateWords } from './SpellLayer'
import { setVaultWords } from '../lib/spell'

const words = (text: string): string[] => candidateWords(text).map((s) => s.word)

beforeEach(() => setVaultWords([]))

describe('candidateWords', () => {
  it('offers ordinary prose to the checker', () => {
    expect(words('This sentance has a typo')).toEqual(['This', 'sentance', 'has', 'typo'])
  })

  it('reports the offset of each occurrence, not just the first', () => {
    const spans = candidateWords('sentance and sentance')
    expect(spans.filter((s) => s.word === 'sentance').map((s) => s.start)).toEqual([0, 13])
  })

  it('skips inline code and fenced code', () => {
    expect(words('a `teh` word')).toEqual(['word'])
    expect(words('```\nteh\n```')).toEqual([])
  })

  it('skips wikilink targets, markdown link URLs and bare URLs', () => {
    expect(words('see [[Teh Note]] here')).toEqual(['see', 'here'])
    expect(words('a [label](http://exmaple.com/teh) link')).toEqual(['label', 'link'])
    expect(words('visit https://exmaple.com/teh now')).toEqual(['visit', 'now'])
  })

  it('skips tags', () => {
    expect(words('tagged #teh here')).toEqual(['tagged', 'here'])
  })

  it('keeps offsets aligned with the ORIGINAL text after masking', () => {
    const text = 'code `x` then sentance'
    const hit = candidateWords(text).find((s) => s.word === 'sentance')!
    expect(text.slice(hit.start, hit.end)).toBe('sentance')
  })
})
