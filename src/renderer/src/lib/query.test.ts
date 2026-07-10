import { describe, it, expect } from 'vitest'
import { parseQuery, matchBlock, scanBlocks, dropFromScanCache, clearScanCache, type QueryBlock } from './query'

/** Match helper: scan `text` (one note) and return the matching block texts. */
const run = (query: string, text: string, path = 'N.md'): string[] => {
  clearScanCache()
  const spec = parseQuery(query)
  return scanBlocks(path, path.replace(/\.md$/, ''), text)
    .filter((b) => matchBlock(b, spec))
    .map((b) => b.text)
}

describe('parseQuery', () => {
  it('parses a flat AND query into a single group', () => {
    const spec = parseQuery('#tag [[Some Page]] todo hello')
    expect(spec.groups).toHaveLength(1)
    expect(spec.groups[0].atoms.map((a) => a.kind)).toEqual(['tag', 'link', 'task', 'term'])
    expect(spec.empty).toBe(false)
  })

  it('splits on uppercase OR into groups', () => {
    const spec = parseQuery('#a OR #b #c')
    expect(spec.groups).toHaveLength(2)
    expect(spec.groups[0].atoms).toHaveLength(1)
    expect(spec.groups[1].atoms).toHaveLength(2)
  })

  it('treats lowercase "or" as a plain word', () => {
    const spec = parseQuery('#a or #b')
    expect(spec.groups).toHaveLength(1)
    expect(spec.groups[0].atoms.map((a) => a.kind)).toEqual(['tag', 'term', 'tag'])
  })

  it('flags an empty query (including dangling ORs)', () => {
    expect(parseQuery('   ').empty).toBe(true)
    expect(parseQuery('OR OR').empty).toBe(true)
  })

  it('parses negation on tags, links and words', () => {
    const spec = parseQuery('-#x -[[Page]] -word')
    expect(spec.groups[0].atoms.every((a) => a.negated)).toBe(true)
  })
})

describe('matchBlock: AND / OR / negation', () => {
  const note = '- one #a\n- two #b\n- three #a #b\n- four plain'

  it('ANDs terms within a group', () => {
    expect(run('#a #b', note)).toEqual(['three #a #b'])
  })

  it('ORs across groups', () => {
    expect(run('#a OR #b', note)).toEqual(['one #a', 'two #b', 'three #a #b'])
  })

  it('mixes AND and OR (AND binds tighter)', () => {
    expect(run('#a #b OR four', note)).toEqual(['three #a #b', 'four plain'])
  })

  it('excludes with -#tag', () => {
    expect(run('#a -#b', note)).toEqual(['one #a'])
  })

  it('excludes with -word', () => {
    expect(run('#a -three', note)).toEqual(['one #a'])
  })

  it('excludes with -[[Page]]', () => {
    const text = '- keep #t\n- drop #t [[Bad Page]]'
    expect(run('#t -[[Bad Page]]', text)).toEqual(['keep #t'])
  })

  it('supports negated task state', () => {
    const text = '- [ ] open #t\n- [x] closed #t\n- plain #t'
    expect(run('#t -done', text)).toEqual(['open #t', 'plain #t'])
  })

  it('never matches an empty query', () => {
    expect(run('', note)).toEqual([])
  })
})

describe('matchBlock: hierarchical tags', () => {
  const note = '- alpha #project/alpha\n- beta #project/beta\n- top #project\n- other #projector'

  it('a parent tag matches its children (segment boundary only)', () => {
    expect(run('#project', note)).toEqual(['alpha #project/alpha', 'beta #project/beta', 'top #project'])
  })

  it('a child tag does not match the parent', () => {
    expect(run('#project/alpha', note)).toEqual(['alpha #project/alpha'])
  })

  it('negation is hierarchical too', () => {
    expect(run('-#project #projector', note)).toEqual(['other #projector'])
  })
})

describe('matchBlock: task state and links', () => {
  it('matches todo / done and [[links]]', () => {
    const text = '- [ ] do thing #x linking [[Page]]\n- [x] done'
    expect(run('todo #x [[Page]]', text)).toEqual(['do thing #x linking [[Page]]'])
    expect(run('done', text)).toEqual(['done'])
  })
})

describe('matchBlock: before/after date filters', () => {
  it('uses the journal date for daily notes', () => {
    const path = 'Daily/2026/07/2026-07-02.md'
    expect(run('before:2026-07-03 note', '- a note', path)).toEqual(['a note'])
    expect(run('before:2026-07-02 note', '- a note', path)).toEqual([]) // exclusive
    expect(run('after:2026-07-01 note', '- a note', path)).toEqual(['a note'])
    expect(run('after:2026-07-02 note', '- a note', path)).toEqual([]) // exclusive
  })

  it('falls back to the frontmatter date property', () => {
    const text = '---\ndate: 2026-01-15\n---\n\n- dated line'
    expect(run('after:2026-01-01 dated', text)).toEqual(['dated line'])
    expect(run('before:2026-01-01 dated', text)).toEqual([])
  })

  it('excludes notes with no date from date-filtered results', () => {
    expect(run('before:2099-01-01 line', '- some line')).toEqual([])
    expect(run('after:1990-01-01 line', '- some line')).toEqual([])
  })

  it('treats an unparseable date value as a plain word', () => {
    expect(run('before:lunch', '- meet before:lunch today')).toEqual(['meet before:lunch today'])
  })
})

describe('matchBlock: prop filters', () => {
  const text = '---\nStatus: reading\nrating: 4\ntopics: [chips, trade]\n---\n\n- the line'

  it('prop:key requires the property to exist', () => {
    expect(run('prop:status line', text)).toEqual(['the line'])
    expect(run('prop:missing line', text)).toEqual([])
  })

  it('keys are case-insensitive', () => {
    expect(run('prop:STATUS=reading line', text)).toEqual(['the line'])
  })

  it('compares values loosely (equality or substring)', () => {
    expect(run('prop:status=reading line', text)).toEqual(['the line'])
    expect(run('prop:status=read line', text)).toEqual(['the line']) // substring
    expect(run('prop:status=writing line', text)).toEqual([])
    expect(run('prop:rating=4 line', text)).toEqual(['the line']) // number vs string
  })

  it('matches any element of list values', () => {
    expect(run('prop:topics=trade line', text)).toEqual(['the line'])
    expect(run('prop:topics=oil line', text)).toEqual([])
  })

  it('supports negation', () => {
    expect(run('-prop:status line', text)).toEqual([])
    expect(run('-prop:missing line', text)).toEqual(['the line'])
  })
})

describe('combinations', () => {
  it('OR groups can each carry their own filters', () => {
    const text = '---\ndate: 2026-05-01\n---\n\n- [ ] fix bug #dev\n- [x] ship it #dev\n- read book #leisure'
    expect(run('todo #dev OR #leisure', text)).toEqual(['fix bug #dev', 'read book #leisure'])
    expect(run('#dev -todo OR prop:date book', text)).toEqual(['ship it #dev', 'read book #leisure'])
  })
})

describe('scanBlocks', () => {
  it('captures tasks, tags and links per content line', () => {
    clearScanCache()
    const blocks = scanBlocks('N.md', 'N', '- [ ] do thing #x linking [[Page]]\n- [x] done')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ isTask: true, checked: false })
    expect(blocks[0].tags).toContain('x')
    expect(blocks[0].links).toContain('page')
    expect(blocks[1]).toMatchObject({ isTask: true, checked: true })
  })

  it('skips fenced code and the query block itself', () => {
    clearScanCache()
    const blocks = scanBlocks('Q.md', 'Q', '```\ncode line\n```\n{{query #x}}\nreal line')
    expect(blocks.map((b) => b.text)).toEqual(['real line'])
  })

  it('returns a cached result for unchanged text', () => {
    const a = scanBlocks('C.md', 'C', 'line one')
    const b = scanBlocks('C.md', 'C', 'line one')
    expect(b).toBe(a) // same reference => cache hit
  })

  it('drops a note from the cache on demand', () => {
    const a = scanBlocks('D.md', 'D', 'before')
    dropFromScanCache('D.md')
    const b = scanBlocks('D.md', 'D', 'before')
    expect(b).not.toBe(a) // re-scanned after eviction
  })

  it('clearScanCache empties everything (vault switch)', () => {
    const a = scanBlocks('E.md', 'E', 'text')
    clearScanCache()
    const b = scanBlocks('E.md', 'E', 'text')
    expect(b).not.toBe(a)
  })

  it('attaches the note date and props to blocks', () => {
    clearScanCache()
    const blocks: QueryBlock[] = scanBlocks('Daily/2026/07/2026-07-01.md', '2026-07-01', '- entry')
    expect(blocks[0].date).toBe('2026-07-01')
    const withFm = scanBlocks('B.md', 'B', '---\ndate: 2026-03-04\nstatus: x\n---\n\n- entry')
    expect(withFm[0].date).toBe('2026-03-04')
    expect(withFm[0].props?.status).toBe('x')
  })
})
