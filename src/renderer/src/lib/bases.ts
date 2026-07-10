/**
 * A "base" is a saved, configurable view over the vault's notes (à la Obsidian
 * Bases): filter by folder/tag and ad-hoc property rules, choose columns, sort,
 * and show as a table or a cover gallery. Definitions persist in localStorage.
 */
export type FilterOp = 'contains' | 'is' | 'is not' | '>' | '<' | '>=' | '<=' | 'exists' | 'empty'

export interface Filter {
  /** Column/property key to test. */
  key: string
  op: FilterOp
  /** Comparison value (ignored for exists/empty). */
  value: string
}

/** Footer aggregation kinds applied per numeric column. */
export type AggKind = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count'

export interface Base {
  id: string
  name: string
  /** Path prefix filter ('' = all notes). */
  folder: string
  /** Required tag ('' = any). */
  tag: string
  /** Ad-hoc property filters (all must pass). */
  filters: Filter[]
  /** Column keys — built-ins 'name'/'cover'/'tags'/'backlinks' plus frontmatter keys. */
  columns: string[]
  /** Column key to group rows by ('' = no grouping). */
  groupKey: string
  /** Footer aggregate per column key (sum/avg/min/max/count). */
  aggregates: Record<string, AggKind>
  sortKey: string
  sortDir: 'asc' | 'desc'
  layout: 'table' | 'gallery' | 'board'
}

/** Legacy localStorage key — read once to migrate old bases into the vault file. */
const LEGACY_KEY = 'inkwell-bases'

/** Coerce stored JSON into a Base[], backfilling fields added over time. */
export function normalizeBases(raw: unknown): Base[] {
  if (!Array.isArray(raw)) return []
  return raw.map((b) => ({ filters: [], layout: 'table', groupKey: '', aggregates: {}, ...b }))
}

/** Bases previously saved in localStorage (used only for the one-time migration). */
export function legacyLocalBases(): Base[] {
  try {
    return normalizeBases(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null'))
  } catch {
    return []
  }
}

export function clearLegacyLocalBases(): void {
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignore */
  }
}

export function newBase(name: string): Base {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Math.random()).slice(2, 10)
  return {
    id,
    name,
    folder: '',
    tag: '',
    filters: [],
    columns: ['name', 'tags', 'backlinks'],
    groupKey: '',
    aggregates: {},
    sortKey: 'name',
    sortDir: 'asc',
    layout: 'table'
  }
}

/** Evaluate one filter rule against a cell value. */
export function passesFilter(value: unknown, f: Filter): boolean {
  const present = value !== undefined && value !== null && value !== ''
  if (f.op === 'exists') return present
  if (f.op === 'empty') return !present
  const s = String(value ?? '').toLowerCase()
  const fv = f.value.trim().toLowerCase()
  if (f.op === 'contains') return s.includes(fv)
  if (f.op === 'is') return s === fv
  if (f.op === 'is not') return s !== fv
  // Ordered comparison: numeric when both parse as numbers, else lexicographic
  // (which sorts ISO dates YYYY-MM-DD correctly, and year-prefixes too).
  const an = Number(value)
  const bn = Number(f.value)
  const numeric = !Number.isNaN(an) && !Number.isNaN(bn) && String(value).trim() !== ''
  const a: number | string = numeric ? an : s
  const b: number | string = numeric ? bn : fv
  if (f.op === '>') return a > b
  if (f.op === '<') return a < b
  if (f.op === '>=') return a >= b
  if (f.op === '<=') return a <= b
  return true
}
