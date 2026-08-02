import { describe, it, expect } from 'vitest'
import { parseQuery, matchBlock, scanBlocks, dropFromScanCache, clearScanCache, type QueryBlock } from './query'
import { VaultIndex } from './vault'
import { parseNote } from './parse'

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

describe('code handling parity with the parser (2026-07 audit)', () => {
  it('uses the shared fence rules: ~~~ does not close a ``` fence', () => {
    const idx = new VaultIndex(
      [parseNote('A.md', '```\ncode #tag1\n~~~\nstill code #tag2')],
      { 'A.md': '```\ncode #tag1\n~~~\nstill code #tag2' }
    )
    expect(idx.query('#tag1')).toHaveLength(0)
    expect(idx.query('#tag2')).toHaveLength(0) // unclosed fence runs to EOF
  })

  it('ignores tags and links inside inline code spans', () => {
    const text = 'use `#notatag` and `[[NotALink]]` but #real works'
    const idx = new VaultIndex([parseNote('A.md', text)], { 'A.md': text })
    expect(idx.query('#notatag')).toHaveLength(0)
    expect(idx.query('[[NotALink]]')).toHaveLength(0)
    expect(idx.query('#real')).toHaveLength(1)
  })
})

describe('date atom validation', () => {
  it('rejects an impossible ISO-shaped date instead of string-comparing it', () => {
    const text = 'entry line'
    const idx = new VaultIndex([parseNote('Daily/2026/07/2026-07-01.md', text)], {
      'Daily/2026/07/2026-07-01.md': text
    })
    // Invalid date atom degrades to a word term, which the block doesn't contain.
    expect(idx.query('before:2026-13-45')).toHaveLength(0)
    expect(idx.query('before:2026-08-01')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Grammar v3 directives: sort: / group: / limit: / as:
// ---------------------------------------------------------------------------

/** A small multi-note vault for exercising result shaping. */
function shapedIndex(): VaultIndex {
  const files: Record<string, string> = {
    // Journal days give blocks a date without any frontmatter.
    'Daily/2026/07/2026-07-01.md': '- [ ] alpha #work\n- [x] bravo #work',
    'Daily/2026/07/2026-07-03.md': '- [ ] charlie #home',
    'Zeta.md': '- delta #work\n- echo'
  }
  return new VaultIndex(
    Object.entries(files).map(([p, t]) => parseNote(p, t)),
    files
  )
}

describe('directive parsing', () => {
  it('parses sort/group/limit/as and keeps them out of the AND groups', () => {
    const spec = parseQuery('#work sort:-date group:note limit:5 as:table')
    expect(spec.groups).toHaveLength(1)
    expect(spec.groups[0].atoms.map((a) => a.kind)).toEqual(['tag'])
    expect(spec.sort).toEqual({ key: 'date', dir: 'desc' })
    expect(spec.groupBy).toBe('note')
    expect(spec.limit).toBe(5)
    expect(spec.layout).toBe('table')
  })

  it('defaults to list layout and no shaping', () => {
    const spec = parseQuery('#work')
    expect(spec.layout).toBe('list')
    expect(spec.sort).toBeUndefined()
    expect(spec.groupBy).toBeUndefined()
    expect(spec.limit).toBeUndefined()
  })

  it('degrades an unknown directive value to a plain word term', () => {
    const spec = parseQuery('group:nonsense')
    expect(spec.groupBy).toBeUndefined()
    expect(spec.groups[0].atoms.map((a) => a.kind)).toEqual(['term'])
    expect(spec.empty).toBe(false)
  })

  // `sort:` is the exception: an unknown key is a PROPERTY name, which is how
  // `sort:-Year` orders notes. Degrading it turned the directive into a search
  // for the literal text "sort:-year", which silently returned the wrong rows.
  it('keeps an unknown sort key as a property name, preserving its case', () => {
    const spec = parseQuery('#film scope:notes sort:-Year')
    expect(spec.sort).toEqual({ key: 'Year', dir: 'desc' })
    expect(spec.groups[0].atoms.map((a) => a.kind)).toEqual(['tag'])
  })

  it('still lowercases the built-in sort keys', () => {
    expect(parseQuery('sort:-DATE').sort).toEqual({ key: 'date', dir: 'desc' })
  })

  it('rejects a non-positive or non-numeric limit', () => {
    expect(parseQuery('limit:0').limit).toBeUndefined()
    expect(parseQuery('limit:-4').limit).toBeUndefined()
    expect(parseQuery('limit:abc').limit).toBeUndefined()
    expect(parseQuery('limit:2.9').limit).toBe(2) // floored
  })

  it('does not treat directives alone as criteria', () => {
    expect(parseQuery('limit:5 sort:date as:table').empty).toBe(true)
    expect(shapedIndex().query('limit:5')).toEqual([])
  })
})

describe('sort:', () => {
  it('orders ascending by date and reverses with a - prefix', () => {
    const idx = shapedIndex()
    const asc = idx.query('#work sort:date').map((b) => b.text)
    const desc = idx.query('#work sort:-date').map((b) => b.text)
    // `text` keeps inline tags — clean() only strips list/task/heading markers.
    expect(asc.slice(0, 2)).toEqual(['alpha #work', 'bravo #work'])
    expect(desc[desc.length - 1]).toBe('delta #work') // undated sinks either way
    expect(asc[asc.length - 1]).toBe('delta #work')
  })

  it('keeps blocks missing the sort key at the bottom in both directions', () => {
    const idx = shapedIndex()
    for (const q of ['sort:date #work', 'sort:-date #work']) {
      const rows = idx.query(q)
      expect(rows[rows.length - 1].date).toBeUndefined()
    }
  })

  it('sorts open tasks before done ones under sort:status', () => {
    const rows = shapedIndex().query('#work sort:status')
    expect(rows[0].checked).toBe(false)
    expect(rows.filter((b) => b.isTask).at(-1)!.checked).toBe(true)
  })

  it('sorts by note name and by block text', () => {
    expect(shapedIndex().query('#work sort:name')[0].name).toBe('2026-07-01')
    expect(shapedIndex().query('#work sort:text').map((b) => b.text)).toEqual([
      'alpha #work',
      'bravo #work',
      'delta #work'
    ])
  })
})

describe('limit:', () => {
  it('caps the result list and reports the pre-limit total', () => {
    const res = shapedIndex().runQuery('#work limit:2')
    expect(res.blocks).toHaveLength(2)
    expect(res.total).toBe(3)
  })

  it('applies after sorting, so limit:1 keeps the true first row', () => {
    expect(shapedIndex().query('#work sort:-text limit:1')[0].text).toBe('delta #work')
  })
})

describe('group:', () => {
  it('buckets by source note in first-appearance order', () => {
    const res = shapedIndex().runQuery('#work group:note sort:text')
    expect(res.groups!.map((g) => g.label)).toEqual(['2026-07-01', 'Zeta'])
    expect(res.groups![0].blocks.map((b) => b.text)).toEqual(['alpha #work', 'bravo #work'])
  })

  it('lists a multi-tag block under each of its tags', () => {
    const files = { 'A.md': '- both #x #y' }
    const idx = new VaultIndex([parseNote('A.md', files['A.md'])], files)
    const res = idx.runQuery('both group:tag')
    expect(res.groups!.map((g) => g.label).sort()).toEqual(['#x', '#y'])
    expect(res.groups!.every((g) => g.blocks.length === 1)).toBe(true)
  })

  it('buckets tasks by status and labels non-tasks separately', () => {
    const res = shapedIndex().runQuery('#work group:status')
    expect(res.groups!.map((g) => g.label).sort()).toEqual(['Done', 'Notes', 'To do'])
  })

  it('groups after limiting, so groups only describe what is shown', () => {
    const res = shapedIndex().runQuery('#work sort:text limit:1 group:note')
    expect(res.groups).toHaveLength(1)
    expect(res.groups![0].label).toBe('2026-07-01')
    expect(res.total).toBe(3)
  })

  it('returns null groups when no group: directive was given', () => {
    expect(shapedIndex().runQuery('#work').groups).toBeNull()
  })
})

describe('scope / cols / gallery (v4 directives)', () => {
  it('defaults to block scope and a list', () => {
    const s = parseQuery('#a')
    expect(s.scope).toBe('blocks')
    expect(s.layout).toBe('list')
  })

  it('scope:notes defaults to a table — a note row is its columns', () => {
    const s = parseQuery('#a scope:notes')
    expect(s.scope).toBe('notes')
    expect(s.layout).toBe('table')
  })

  it('accepts singular scope:note and explicit blocks', () => {
    expect(parseQuery('#a scope:note').scope).toBe('notes')
    expect(parseQuery('#a scope:blocks').scope).toBe('blocks')
  })

  it('parses cols: and as:gallery', () => {
    const s = parseQuery('#a scope:notes cols:name,Started,Ended as:gallery')
    expect(s.cols).toEqual(['name', 'Started', 'Ended'])
    expect(s.layout).toBe('gallery')
  })

  // The language is whitespace-tokenized, so a space ends the directive: the
  // trailing names fall out as word terms and silently narrow the search.
  it('cols: takes no spaces around the commas', () => {
    const s = parseQuery('scope:notes cols:name, Started')
    expect(s.cols).toEqual(['name'])
    expect(s.groups[0].atoms.some((a) => a.kind === 'term' && a.value === 'started')).toBe(true)
  })

  // Same forgiving rule as the other directives: a typo narrows, never surprises.
  it('degrades an unusable directive value to a word term', () => {
    const s = parseQuery('scope:sideways')
    expect(s.scope).toBe('blocks')
    expect(s.groups[0].atoms[0]).toMatchObject({ kind: 'term', value: 'scope:sideways' })
  })
})
