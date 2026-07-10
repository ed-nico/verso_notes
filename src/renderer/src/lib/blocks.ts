/**
 * Block model (flat, Word-style outline). The document is an ordered, flat list
 * of typed blocks. List items carry an indent `level` (0, 1, 2…) — there is no
 * tree, so indenting/outdenting only changes a line's level in place and never
 * moves it. Serializes to clean Markdown (nested bullets via indentation).
 */

type BlockType = 'paragraph' | 'heading' | 'bullet' | 'task' | 'code' | 'table'

export interface Block {
  id: number
  type: BlockType
  /** Content without the structural marker. For code/table: the raw body. */
  text: string
  /** Heading level (1–6) for headings; indent depth for list items; 0 otherwise. */
  level: number
  checked?: boolean
  ordered?: boolean
  /** Original ordered-list number (e.g. the 3 in `3. item`), re-emitted on save. */
  ordinal?: number
  lang?: string
  /** Obsidian-style `^block-anchor` id, kept out of the editable text but re-appended on save. */
  anchor?: string
  collapsed: boolean
}

let counter = 1
function nextId(): number {
  return counter++
}

/** An Obsidian-style `^anchor` marker — hidden from the editable text, preserved on save. */
const ANCHOR_RE = /\s\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/

export function makeBlock(partial: Partial<Block> = {}): Block {
  return { id: nextId(), type: 'paragraph', text: '', level: 0, collapsed: false, ...partial }
}

export const isList = (b: Block): boolean => b.type === 'bullet' || b.type === 'task'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const FENCE_RE = /^(```|~~~)(.*)$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TASK_RE = /^\[([ xX])\]\s+(.*)$/

interface ParsedDoc {
  blocks: Block[]
  frontmatter: string
}

function indentUnits(indent: string): number {
  const tabs = indent.match(/\t/g)
  if (tabs) return tabs.length
  return Math.floor(indent.length / 2)
}

export function parseBlocks(text: string): ParsedDoc {
  const lines = text.split('\n')

  let frontmatter = ''
  let i = 0
  if (lines[0]?.trim() === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === '---') {
        frontmatter = lines.slice(0, j + 1).join('\n') + '\n'
        i = j + 1
        if (lines[i]?.trim() === '') i++
        break
      }
    }
  }

  const blocks: Block[] = []
  let prevListLevel = -1 // level of the last list item, for clamping nesting
  const push = (b: Block): void => {
    blocks.push(b)
    prevListLevel = isList(b) ? b.level : -1
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }

    // Soft continuation of a list item (indented non-bullet line).
    const last = blocks[blocks.length - 1]
    if (
      last &&
      isList(last) &&
      indentUnits(line.match(/^\s*/)![0]) > last.level &&
      !line.match(HEADING_RE) &&
      !line.replace(/^\s+/, '').match(LIST_RE) &&
      !line.match(FENCE_RE)
    ) {
      // Keep indentation beyond the item's own hanging indent (level+1 units),
      // so extra-indented continuation lines round-trip unchanged.
      const hang = '  '.repeat(last.level + 1)
      last.text += '\n' + (line.startsWith(hang) ? line.slice(hang.length).trimEnd() : line.trim())
      i++
      continue
    }

    const fence = line.match(FENCE_RE)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].match(FENCE_RE)) {
        body.push(lines[i])
        i++
      }
      i++
      push(makeBlock({ type: 'code', text: body.join('\n'), lang: fence[2].trim() }))
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      push(makeBlock({ type: 'heading', level: heading[1].length, text: heading[2] }))
      i++
      continue
    }

    if (line.trim().startsWith('|')) {
      const rows: string[] = [line.trim()]
      i++
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim())
        i++
      }
      push(makeBlock({ type: 'table', text: rows.join('\n') }))
      continue
    }

    const list = line.match(LIST_RE)
    if (list) {
      const want = indentUnits(list[1])
      const level = Math.max(0, Math.min(want, prevListLevel + 1))
      const ordered = /\d/.test(list[2])
      const ordinal = ordered ? parseInt(list[2], 10) : undefined
      const task = list[3].match(TASK_RE)
      if (task) push(makeBlock({ type: 'task', level, checked: task[1].toLowerCase() === 'x', text: task[2] }))
      else push(makeBlock({ type: 'bullet', level, ordered, ordinal, text: list[3] }))
      i++
      continue
    }

    // Paragraph: accumulate consecutive plain lines.
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(HEADING_RE) &&
      !lines[i].match(LIST_RE) &&
      !lines[i].match(FENCE_RE) &&
      !lines[i].trim().startsWith('|')
    ) {
      para.push(lines[i])
      i++
    }
    push(makeBlock({ type: 'paragraph', text: para.join('\n') }))
  }

  // Lift trailing `^anchor` markers out of the editable text so they never show,
  // but remember them on the block — serialization re-appends them.
  for (const b of blocks) {
    if (b.type === 'code' || b.type === 'table') continue
    const m = b.text.match(ANCHOR_RE)
    if (m) {
      b.anchor = m[1]
      b.text = b.text.replace(ANCHOR_RE, '')
    }
  }

  return { blocks, frontmatter }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeBlock(b: Block): string {
  // A preserved `^anchor` goes back at the very end of the block's markdown.
  const anchor = b.anchor && b.type !== 'code' && b.type !== 'table' ? ` ^${b.anchor}` : ''
  switch (b.type) {
    case 'heading':
      return `${'#'.repeat(b.level || 1)} ${b.text}${anchor}`
    case 'code':
      return `\`\`\`${b.lang ?? ''}\n${b.text}\n\`\`\``
    case 'table':
      return b.text
    case 'bullet':
    case 'task': {
      const pad = '  '.repeat(b.level)
      const marker =
        b.type === 'task' ? `- [${b.checked ? 'x' : ' '}] ` : b.ordered ? `${b.ordinal ?? 1}. ` : '- '
      const [first, ...rest] = b.text.split('\n')
      return [`${pad}${marker}${first}`, ...rest.map((l) => `${pad}  ${l}`)].join('\n') + anchor
    }
    default:
      return b.text + anchor
  }
}

export function serializeBlocks(blocks: Block[], frontmatter = ''): string {
  let body = ''
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) body += isList(blocks[i - 1]) && isList(blocks[i]) ? '\n' : '\n\n'
    body += serializeBlock(blocks[i])
  }
  return frontmatter ? `${frontmatter}${body}\n` : `${body}\n`
}

// ---------------------------------------------------------------------------
// Flat helpers
// ---------------------------------------------------------------------------

export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...b }))
}

export function indexOfBlock(blocks: Block[], id: number): number {
  return blocks.findIndex((b) => b.id === id)
}

/** [start, end) range of blocks that belong to the block at `i` (its foldable section). */
export function childrenRange(blocks: Block[], i: number): [number, number] {
  const b = blocks[i]
  if (!b) return [i + 1, i + 1]
  let j = i + 1
  if (b.type === 'heading') {
    while (j < blocks.length && !(blocks[j].type === 'heading' && blocks[j].level <= b.level)) j++
  } else if (isList(b)) {
    while (j < blocks.length && isList(blocks[j]) && blocks[j].level > b.level) j++
  }
  return [i + 1, j]
}

export function foldableAt(blocks: Block[], i: number): boolean {
  const [s, e] = childrenRange(blocks, i)
  return e > s
}

/**
 * Move blocks[start,end) (a subtree or selected range) one *sibling unit* up/down.
 * The group swaps places with the whole adjacent sibling subtree — it can never land
 * inside a neighbour's children. At the first/last sibling position it "nudges" out
 * (Workflowy-style): up → last child of the parent's previous sibling, down → first
 * child of the parent's next sibling, auto-expanding that target so the group stays
 * visible. Returns the reordered list, or null when there is nowhere to go.
 */
export function moveUnit(blocks: Block[], start: number, end: number, dir: -1 | 1): Block[] | null {
  const head = blocks[start]
  if (!head || end <= start || end > blocks.length) return null
  const L = head.level
  let insertAt: number
  let expandId: number | null = null

  if (dir < 0) {
    let p = start - 1
    if (p < 0) return null
    if (isList(head)) {
      while (p >= 0 && isList(blocks[p]) && blocks[p].level > L) p--
      if (p < 0) return null
      const pb = blocks[p]
      if (isList(pb) && pb.level === L) {
        insertAt = p // swap with the previous sibling's whole subtree
      } else if (isList(pb) && pb.level === L - 1) {
        // First child: hop above the parent iff the parent has a previous sibling
        // (the group becomes that sibling's last child, keeping its level).
        let u = p - 1
        while (u >= 0 && isList(blocks[u]) && blocks[u].level > L - 1) u--
        if (u < 0 || !isList(blocks[u]) || blocks[u].level !== L - 1) return null
        insertAt = p
        if (blocks[u].collapsed) expandId = blocks[u].id
      } else if (!isList(pb) && L === 0) {
        insertAt = p // hop a single non-list block
      } else return null
    } else if (isList(blocks[p])) {
      // Non-list block moving above a list: hop the whole containing top-level subtree.
      while (p >= 1 && isList(blocks[p - 1]) && blocks[p].level > 0) p--
      insertAt = p
    } else {
      insertAt = p
    }
  } else {
    const q = end
    if (q >= blocks.length) return null
    const nb = blocks[q]
    if (isList(head)) {
      if (isList(nb) && nb.level === L) {
        insertAt = childrenRange(blocks, q)[1] // land after the next sibling's subtree
      } else if (isList(nb) && nb.level === L - 1) {
        // Last child: hop below the parent — become the next sibling's first child.
        insertAt = q + 1
        if (nb.collapsed) expandId = nb.id
      } else if (!isList(nb) && L === 0) {
        insertAt = q + 1
      } else return null
    } else {
      insertAt = isList(nb) ? childrenRange(blocks, q)[1] : q + 1
    }
  }

  const next = cloneBlocks(blocks)
  const group = next.splice(start, end - start)
  next.splice(dir < 0 ? insertAt : insertAt - group.length, 0, ...group)
  if (expandId != null) {
    const t = indexOfBlock(next, expandId)
    if (t >= 0) next[t] = { ...next[t], collapsed: false }
  }
  return next
}

/** Indices hidden inside any collapsed block's section. */
function hiddenIndices(blocks: Block[]): Set<number> {
  const hidden = new Set<number>()
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].collapsed) {
      const [s, e] = childrenRange(blocks, i)
      for (let k = s; k < e; k++) hidden.add(k)
    }
  }
  return hidden
}

/** Visible blocks in order, with render depth (indent for list items). */
export function visibleBlocks(blocks: Block[]): { block: Block; index: number; depth: number }[] {
  const hidden = hiddenIndices(blocks)
  const out: { block: Block; index: number; depth: number }[] = []
  for (let i = 0; i < blocks.length; i++) {
    if (hidden.has(i)) continue
    const b = blocks[i]
    out.push({ block: b, index: i, depth: isList(b) ? b.level : 0 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Markdown shortcuts + tables
// ---------------------------------------------------------------------------

export interface Shortcut {
  patch: Partial<Block>
  strip: number
}

export function detectShortcut(text: string): Shortcut | null {
  let m: RegExpMatchArray | null
  if ((m = text.match(/^(#{1,6})\s/))) return { patch: { type: 'heading', level: m[1].length }, strip: m[0].length }
  if ((m = text.match(/^\[([ xX]?)\]\s/)))
    return { patch: { type: 'task', checked: m[1].toLowerCase() === 'x' }, strip: m[0].length }
  if (text.match(/^[-*+]\s/)) return { patch: { type: 'bullet' }, strip: 2 }
  if ((m = text.match(/^\d+[.)]\s/))) return { patch: { type: 'bullet', ordered: true }, strip: m[0].length }
  // ```          → code block; ```ts → code block tagged "ts". Fires on the trailing
  // space so the language isn't swallowed into the body.
  if ((m = text.match(/^```([\w+#.-]*)\s$/))) return { patch: { type: 'code', lang: m[1] }, strip: m[0].length }
  return null
}

export function parseTable(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|'))
  const cells = (line: string): string[] =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  if (lines.length === 0) return { header: [], rows: [] }
  const header = cells(lines[0])
  const bodyStart = lines[1] && /^[|\s:-]+$/.test(lines[1]) ? 2 : 1
  return { header, rows: lines.slice(bodyStart).map(cells) }
}

export const TABLE_TEMPLATE = '| Column | Column |\n| --- | --- |\n|  |  |'
