import { describe, it, expect, beforeEach } from 'vitest'
import { clearSimilarCache, similarNotes } from './similar'

const VAULT: Record<string, string> = {
  'Rust.md': 'The borrow checker enforces ownership and lifetimes in rust programs. Cargo builds crates.',
  'Ownership.md': 'Ownership and lifetimes are the heart of rust. The borrow checker rejects aliasing bugs.',
  'Cooking.md': 'Simmer the onions, deglaze the pan, season the sauce, and plate the pasta.',
  'Baking.md': 'Proof the dough, preheat the oven, and bake until the crust browns.',
  'Templates/Recipe.md': 'Simmer season sauce pasta onions oven dough'
}

beforeEach(() => clearSimilarCache())

describe('similarNotes (TF-IDF cosine)', () => {
  it('ranks the topically-related note first', () => {
    const hits = similarNotes('Rust.md', VAULT)
    expect(hits[0]?.path).toBe('Ownership.md')
  })

  it('does not pair unrelated notes', () => {
    const hits = similarNotes('Cooking.md', VAULT)
    expect(hits.map((h) => h.path)).not.toContain('Rust.md')
    expect(hits.map((h) => h.path)).not.toContain('Ownership.md')
  })

  it('never suggests templates or the note itself', () => {
    const hits = similarNotes('Cooking.md', VAULT)
    expect(hits.map((h) => h.path)).not.toContain('Templates/Recipe.md')
    expect(hits.map((h) => h.path)).not.toContain('Cooking.md')
  })

  it('returns nothing for a note too short to characterize', () => {
    expect(similarNotes('Stub.md', { ...VAULT, 'Stub.md': 'hi there' })).toEqual([])
  })

  it('returns nothing in a tiny vault', () => {
    expect(similarNotes('A.md', { 'A.md': 'one two three four five six', 'B.md': 'one two three' })).toEqual([])
  })
})
