import { describe, it, expect } from 'vitest'
import { childrenRange, moveUnit, parseBlocks, serializeBlocks, type Block } from './blocks'

/** parse → serialize helper. */
const roundTrip = (text: string): string => {
  const { blocks, frontmatter } = parseBlocks(text)
  return serializeBlocks(blocks, frontmatter)
}

describe('parseBlocks / serializeBlocks round trip', () => {
  it('preserves ^block-anchors on bullets, headings and paragraphs', () => {
    const text = '# Title ^head1\n\n- item one ^abc123\n- item two\n\na paragraph ^para-9\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps the anchor out of the editable text', () => {
    const { blocks } = parseBlocks('- item one ^abc123\n')
    expect(blocks[0].text).toBe('item one')
    expect(blocks[0].anchor).toBe('abc123')
  })

  it('preserves sequential ordered-list numbers', () => {
    const text = '1. first\n2. second\n3. third\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('preserves non-sequential ordered-list numbers', () => {
    const text = '3. third\n5. fifth\n9. ninth\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('serializes a new ordered item (no ordinal) as 1.', () => {
    const { blocks } = parseBlocks('- x\n')
    blocks[0].ordered = true
    blocks[0].ordinal = undefined
    expect(serializeBlocks(blocks)).toBe('1. x\n')
  })

  it('preserves soft-continuation lines at their hanging indent', () => {
    const text = '- item\n  continuation line\n- next\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('preserves extra indentation on continuation lines', () => {
    const text = '- item\n    deeper continuation\n  normal continuation\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('preserves continuation lines under nested items', () => {
    const text = '- parent\n  - child\n    child continuation\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('leaves fenced code with fake list/anchor syntax untouched', () => {
    const text = '```js\n1. not a list\n- also not\ntext ^not-an-anchor\n```\n'
    expect(roundTrip(text)).toBe(text)
    const { blocks } = parseBlocks(text)
    expect(blocks[0].type).toBe('code')
    expect(blocks[0].anchor).toBeUndefined()
    expect(blocks[0].text).toBe('1. not a list\n- also not\ntext ^not-an-anchor')
  })

  it('round-trips tasks, quotes and tables', () => {
    const text =
      '- [ ] open task\n- [x] done task ^t1\n\n> a quote line\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('round-trips a combined fixture with frontmatter', () => {
    // NB: no blank line after the closing --- (the serializer never emits one).
    const text = [
      '---',
      'title: Test',
      '---',
      '# Heading',
      '',
      '- bullet ^anch-1',
      '  continued here',
      '1. one',
      '2. two',
      '',
      '```',
      '3. fake',
      '```',
      '',
      'closing paragraph',
      ''
    ].join('\n')
    expect(roundTrip(text)).toBe(text)
  })
})

// ---------------------------------------------------------------------------
// moveUnit — sibling-subtree moves
// ---------------------------------------------------------------------------

/** Build blocks from a compact outline: "A", "  A1" (2 spaces = 1 level), "A*" = collapsed. */
const outline = (lines: string[]): Block[] =>
  lines.map((l, i) => {
    const level = (l.match(/^ */)?.[0].length ?? 0) / 2
    const collapsed = l.trim().endsWith('*')
    const text = l.trim().replace(/\*$/, '')
    return { id: i + 1, type: 'bullet' as const, text, level, collapsed }
  })

const shape = (blocks: Block[]): string[] =>
  blocks.map((b) => '  '.repeat(b.level) + b.text + (b.collapsed ? '*' : ''))

/** moveUnit on the subtree headed by the block named `text`. */
const moveSub = (blocks: Block[], text: string, dir: -1 | 1): Block[] | null => {
  const i = blocks.findIndex((b) => b.text === text)
  return moveUnit(blocks, i, childrenRange(blocks, i)[1], dir)
}

describe('moveUnit', () => {
  it('carries children when moving up past a plain sibling', () => {
    const next = moveSub(outline(['A', 'B', '  B1']), 'B', -1)
    expect(shape(next!)).toEqual(['B', '  B1', 'A'])
  })

  it('swaps with the previous sibling subtree, never interleaving', () => {
    const next = moveSub(outline(['A', '  A1', 'B', '  B1']), 'B', -1)
    expect(shape(next!)).toEqual(['B', '  B1', 'A', '  A1'])
  })

  it('swaps with the next sibling subtree when moving down', () => {
    const next = moveSub(outline(['A', '  A1', 'B', '  B1']), 'A', 1)
    expect(shape(next!)).toEqual(['B', '  B1', 'A', '  A1'])
  })

  it('jumps a collapsed sibling subtree as one unit', () => {
    const next = moveSub(outline(['A*', '  A1', '  A2', 'B']), 'B', -1)
    expect(shape(next!)).toEqual(['B', 'A*', '  A1', '  A2'])
  })

  it('nested sibling swap keeps both subtrees intact', () => {
    const next = moveSub(outline(['P', '  X', '    X1', '  Y', '    Y1']), 'Y', -1)
    expect(shape(next!)).toEqual(['P', '  Y', '    Y1', '  X', '    X1'])
  })

  it('first child moving up hops out to become the last child of the uncle', () => {
    const next = moveSub(outline(['U', 'P', '  X', '  Y']), 'X', -1)
    expect(shape(next!)).toEqual(['U', '  X', 'P', '  Y'])
  })

  it('expands a collapsed uncle so the hopped block stays visible', () => {
    const next = moveSub(outline(['U*', '  U1', 'P', '  X']), 'X', -1)
    expect(shape(next!)).toEqual(['U', '  U1', '  X', 'P'])
  })

  it('first child of the first parent cannot move up', () => {
    expect(moveSub(outline(['P', '  X', '  Y']), 'X', -1)).toBeNull()
  })

  it('last child moving down hops out to become the first child of the aunt', () => {
    const next = moveSub(outline(['P', '  X', '  Y', 'N', '  N1']), 'Y', 1)
    expect(shape(next!)).toEqual(['P', '  X', 'N', '  Y', '  N1'])
  })

  it('expands a collapsed aunt so the hopped block stays visible', () => {
    const next = moveSub(outline(['P', '  X', 'N*', '  N1']), 'X', 1)
    expect(shape(next!)).toEqual(['P', 'N', '  X', '  N1'])
  })

  it('last child of the last parent cannot move down', () => {
    expect(moveSub(outline(['P', '  X', '  Y']), 'Y', 1)).toBeNull()
  })

  it('top-level blocks stop at the document edges', () => {
    const doc = outline(['A', 'B'])
    expect(moveSub(doc, 'A', -1)).toBeNull()
    expect(moveSub(doc, 'B', 1)).toBeNull()
  })

  it('a top-level bullet hops over an adjacent non-list block', () => {
    const doc: Block[] = [
      { id: 1, type: 'paragraph', text: 'para', level: 0, collapsed: false },
      { id: 2, type: 'bullet', text: 'A', level: 0, collapsed: false },
      { id: 3, type: 'bullet', text: 'A1', level: 1, collapsed: false }
    ]
    const next = moveUnit(doc, 1, 3, -1)
    expect(next!.map((b) => b.text)).toEqual(['A', 'A1', 'para'])
  })

  it('a paragraph moving up hops the whole list above it', () => {
    const doc: Block[] = [
      { id: 1, type: 'bullet', text: 'A', level: 0, collapsed: false },
      { id: 2, type: 'bullet', text: 'A1', level: 1, collapsed: false },
      { id: 3, type: 'paragraph', text: 'para', level: 0, collapsed: false }
    ]
    const next = moveUnit(doc, 2, 3, -1)
    expect(next!.map((b) => b.text)).toEqual(['para', 'A', 'A1'])
  })

  it('a nested bullet cannot float above a non-list block', () => {
    const doc: Block[] = [
      { id: 1, type: 'paragraph', text: 'para', level: 0, collapsed: false },
      { id: 2, type: 'bullet', text: 'X', level: 1, collapsed: false }
    ]
    expect(moveUnit(doc, 1, 2, -1)).toBeNull()
  })
})
