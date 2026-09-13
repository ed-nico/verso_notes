/**
 * Rows for a Base, and the cell accessor they sort and filter by.
 *
 * Lives in its own module because BOTH the Bases screen and the reader's inline
 * `{{base …}}` embed need it, and the reader can't import from screens.tsx —
 * screens.tsx already imports the reader's BlockView, so that would be a cycle.
 */
import type { ParsedNote } from '@shared/types'
import { passesFilter, type Base } from '@vlib/bases'
import { normTag } from '@vlib/supertags'

export function cellValue(n: ParsedNote, key: string): unknown {
  if (key === 'name') return n.name
  if (key === 'tags') return n.tags.join(', ')
  return n.frontmatter[key]
}

export function baseRows(base: Base, parsed: Record<string, ParsedNote>): ParsedNote[] {
  let rows = Object.values(parsed)
  if (base.folder) rows = rows.filter((n) => n.path.startsWith(base.folder))
  if (base.tag) rows = rows.filter((n) => n.tags.some((t) => normTag(t) === normTag(base.tag)))
  rows = rows.filter((n) => base.filters.every((f) => passesFilter(cellValue(n, f.key), f)))
  const dir = base.sortDir === 'desc' ? -1 : 1
  const key = base.sortKey || 'name'
  rows.sort((a, b) => {
    const va = cellValue(a, key)
    const vb = cellValue(b, key)
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va ?? '').localeCompare(String(vb ?? '')) * dir
  })
  return rows
}
