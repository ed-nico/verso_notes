import { describe, it, expect } from 'vitest'
import {
  frontmatterTags,
  getFrontmatter,
  parseFrontmatter,
  replaceFrontmatter,
  serializeFrontmatter,
  stripFrontmatterFast
} from './frontmatter'

describe('parseFrontmatter', () => {
  it('returns the whole text as body when there is no frontmatter', () => {
    const fm = parseFrontmatter('just a body')
    expect(fm.data).toEqual({})
    expect(fm.body).toBe('just a body')
    expect(fm.raw).toBe('')
    expect(fm.bodyLine).toBe(0)
  })

  it('parses a frontmatter block and skips one blank line before the body', () => {
    const fm = parseFrontmatter('---\ntitle: Hi\n---\n\nBody here')
    expect(fm.data.title).toBe('Hi')
    expect(fm.body).toBe('Body here')
    expect(fm.bodyLine).toBe(4)
  })

  it('keeps ISO dates as YYYY-MM-DD strings (not Date objects)', () => {
    const fm = parseFrontmatter('---\ndate: 2026-06-24\n---\n\nx')
    expect(fm.data.date).toBe('2026-06-24')
  })

  it('treats malformed YAML as no frontmatter — the whole text stays as body', () => {
    const fm = parseFrontmatter('---\n: : :\n---\nbody')
    expect(fm.data).toEqual({})
    expect(fm.body).toBe('---\n: : :\n---\nbody')
  })

  it('does not swallow prose after a leading --- horizontal rule', () => {
    const src = '---\nScene one prose\n\nmore\n---\nrest'
    const fm = parseFrontmatter(src)
    expect(fm.data).toEqual({})
    expect(fm.body).toBe(src) // nothing lost
    expect(fm.bodyLine).toBe(0)
  })

  it('does not treat a fenced list as frontmatter', () => {
    const src = '---\n- a\n- b\n---\nrest'
    const fm = parseFrontmatter(src)
    expect(fm.data).toEqual({})
    expect(fm.body).toBe(src)
  })

  it('still accepts an empty block between fences as (empty) frontmatter', () => {
    const fm = parseFrontmatter('---\n---\nbody')
    expect(fm.data).toEqual({})
    expect(fm.body).toBe('body')
  })
})

describe('stripFrontmatterFast', () => {
  it('strips a real frontmatter block', () => {
    expect(stripFrontmatterFast('---\ntitle: Hi\n---\n\nbody')).toBe('body')
  })
  it('strips an unindented list under a key (common YAML style)', () => {
    expect(stripFrontmatterFast('---\ntags:\n- a\n- b\n---\nbody')).toBe('body')
  })
  it('keeps prose after a leading hr intact', () => {
    const src = '---\nScene one prose\n\nmore\n---\nrest'
    expect(stripFrontmatterFast(src)).toBe(src)
  })
})

describe('replaceFrontmatter', () => {
  it('replaces frontmatter while preserving the body', () => {
    const out = replaceFrontmatter('---\na: 1\n---\n\nbody', { b: 2 })
    const reparsed = parseFrontmatter(out)
    expect(reparsed.data).toEqual({ b: 2 })
    expect(reparsed.body).toBe('body')
  })

  it('drops the block entirely when data is empty', () => {
    expect(replaceFrontmatter('---\na: 1\n---\n\nbody', {})).toBe('body')
  })
})

describe('serializeFrontmatter', () => {
  it('returns empty string for empty data', () => {
    expect(serializeFrontmatter({})).toBe('')
  })
})

describe('frontmatterTags', () => {
  it('normalizes array tags (strip #, lowercase)', () => {
    expect(frontmatterTags({ tags: ['#Important', 'Work'] })).toEqual(['important', 'work'])
  })
  it('accepts a comma/space-separated string', () => {
    expect(frontmatterTags({ tags: 'a, b c' })).toEqual(['a', 'b', 'c'])
  })
  it('returns empty when absent', () => {
    expect(frontmatterTags({})).toEqual([])
  })
})

describe('getFrontmatter', () => {
  it('returns just the data map', () => {
    expect(getFrontmatter('---\nx: 1\n---\nbody')).toEqual({ x: 1 })
  })
})

describe('datetime handling', () => {
  it('preserves a datetime with its time component (no truncation)', () => {
    const fm = parseFrontmatter('---\ndue: 2026-07-03T09:30:00\n---\n\nx')
    expect(fm.data.due).toBe('2026-07-03T09:30:00')
  })

  it('round-trips a datetime through an unrelated edit', () => {
    const src = '---\ndue: 2026-07-03T09:30:00\n---\n\nx'
    const out = replaceFrontmatter(src, { due: '2026-07-03T09:30:00', extra: 1 })
    expect(out).toContain('due: 2026-07-03T09:30:00')
    expect(getFrontmatter(out)).toEqual({ due: '2026-07-03T09:30:00', extra: 1 })
  })

  it('round-trips a date-only value as YYYY-MM-DD', () => {
    const src = '---\ndate: 2026-06-24\n---\n\nx'
    expect(parseFrontmatter(src).data.date).toBe('2026-06-24')
    const out = replaceFrontmatter(src, { date: '2026-06-24', other: 'y' })
    expect(out).toContain('date: 2026-06-24')
  })
})

describe('replaceFrontmatter format preservation', () => {
  const src = '---\n# note metadata\ntitle: Hi # keep me\nrating: 4\nauthor: "[[Mara Lindqvist]]"\n---\n\nbody'

  it('preserves comments when another key changes', () => {
    const out = replaceFrontmatter(src, { title: 'Hi', rating: 5, author: '[[Mara Lindqvist]]' })
    expect(out).toContain('# note metadata')
    expect(out).toContain('title: Hi # keep me')
    expect(getFrontmatter(out)).toEqual({ title: 'Hi', rating: 5, author: '[[Mara Lindqvist]]' })
  })

  it('preserves key order and untouched quoting', () => {
    const out = replaceFrontmatter(src, { title: 'Hi', rating: 5, author: '[[Mara Lindqvist]]' })
    expect(out.indexOf('title')).toBeLessThan(out.indexOf('rating'))
    expect(out.indexOf('rating')).toBeLessThan(out.indexOf('author'))
    expect(out).toContain('author: "[[Mara Lindqvist]]"') // untouched key keeps its quoting
    expect(out.endsWith('\n\nbody')).toBe(true)
  })

  it('adds a new key without disturbing the rest', () => {
    const out = replaceFrontmatter(src, {
      title: 'Hi',
      rating: 4,
      author: '[[Mara Lindqvist]]',
      status: 'reading'
    })
    expect(out).toContain('# note metadata')
    expect(out).toContain('title: Hi # keep me')
    expect(out).toContain('status: reading')
    expect(getFrontmatter(out).status).toBe('reading')
  })

  it('deletes a removed key but keeps comments on the others', () => {
    const out = replaceFrontmatter(src, { title: 'Hi', author: '[[Mara Lindqvist]]' })
    expect(out).not.toContain('rating')
    expect(out).toContain('title: Hi # keep me')
    expect(getFrontmatter(out)).toEqual({ title: 'Hi', author: '[[Mara Lindqvist]]' })
  })

  it('creates a fresh block when the note had none', () => {
    const out = replaceFrontmatter('plain body', { a: 1 })
    expect(getFrontmatter(out)).toEqual({ a: 1 })
    expect(out.endsWith('\n\nplain body')).toBe(true)
  })

  it('handles complex values (lists of maps) on changed keys', () => {
    const out = replaceFrontmatter(src, {
      title: 'Hi',
      rating: 4,
      author: '[[Mara Lindqvist]]',
      fields: [{ name: 'due', type: 'date' }]
    })
    const data = getFrontmatter(out)
    expect(data.fields).toEqual([{ name: 'due', type: 'date' }])
    expect(out).toContain('# note metadata')
  })
})
