import { describe, expect, it } from 'vitest'
import { parseCallout } from './callouts'

describe('parseCallout', () => {
  it('reads kind, title and body', () => {
    const c = parseCallout('[!warning] Careful\nline one\nline two')
    expect(c?.kind.key).toBe('warning')
    expect(c?.title).toBe('Careful')
    expect(c?.body).toBe('line one\nline two')
  })

  it('falls back to the kind label when no title is given', () => {
    expect(parseCallout('[!tip]')?.title).toBe('Tip')
  })

  it('resolves aliases to their canonical kind', () => {
    expect(parseCallout('[!hint] x')?.kind.key).toBe('tip')
    expect(parseCallout('[!error] x')?.kind.key).toBe('danger')
    expect(parseCallout('[!TLDR] x')?.kind.key).toBe('abstract')
  })

  it('reads the fold markers', () => {
    expect(parseCallout('[!note] a')).toMatchObject({ foldable: false, startFolded: false })
    expect(parseCallout('[!note]+ a')).toMatchObject({ foldable: true, startFolded: false })
    expect(parseCallout('[!note]- a')).toMatchObject({ foldable: true, startFolded: true })
  })

  // A typo shouldn't silently demote the box back to a plain quote.
  it('keeps an unknown kind as a callout, styled as a note', () => {
    expect(parseCallout('[!wat] x')?.kind.key).toBe('note')
  })

  it('returns null for an ordinary quote', () => {
    expect(parseCallout('just a quote')).toBeNull()
    expect(parseCallout('[not a callout] x')).toBeNull()
  })
})
