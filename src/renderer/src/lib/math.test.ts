import { describe, expect, it } from 'vitest'
import { MATH_INLINE_SRC } from './math'

/** Every `$…$` the inline rule would render as math in `s`. */
const found = (s: string): string[] => {
  const re = new RegExp(MATH_INLINE_SRC, 'gu')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1])
  return out
}

describe('inline math delimiters', () => {
  it('renders real math', () => {
    expect(found('Solve $a^2 + b^2 = c^2$ now.')).toEqual(['a^2 + b^2 = c^2'])
    expect(found('$E = mc^2$')).toEqual(['E = mc^2'])
  })

  // The whole point of the guards — prose full of prices must stay prose.
  it('leaves currency alone', () => {
    expect(found('it costs $5 and $10 in prose.')).toEqual([])
    expect(found('I paid $5. She paid $7.')).toEqual([])
    expect(found('Range $100-$200 today.')).toEqual([])
    expect(found('$5')).toEqual([])
  })

  it('needs non-space just inside both delimiters', () => {
    expect(found('A $ B $ C')).toEqual([])
    expect(found('a $x $ b')).toEqual([])
  })

  it('does not span two amounts through a $', () => {
    // The body class excludes `$`, so no match can swallow one to reach another.
    expect(found('from $5 to $9 dollars')).toEqual([])
  })

  it('finds math alongside prices in the same line', () => {
    expect(found('Given $n > 0$ it costs $5 and $10.')).toEqual(['n > 0'])
  })
})
