import { describe, it, expect } from 'vitest'
import { tendReport } from './tend'
import { parseNote } from './parse'
import { resolveTarget, basename } from './links'
import type { NoteFile, ParsedNote } from '@shared/types'

const NOW = 1_800_000_000_000 // fixed "now" for stale checks
const DAY = 24 * 60 * 60 * 1000

/** Build a report from { path: text } (+ optional per-path mtimes). */
function report(notes: Record<string, string>, mtimes: Record<string, number> = {}) {
  const files: NoteFile[] = Object.keys(notes).map((path) => ({
    path,
    name: basename(path),
    mtime: mtimes[path] ?? NOW
  }))
  const parsed: Record<string, ParsedNote> = {}
  for (const [p, t] of Object.entries(notes)) parsed[p] = parseNote(p, t)
  const paths = Object.keys(notes)
  const resolve = (raw: string): string | null => resolveTarget(raw, paths)
  // Backlink count = distinct sources whose links resolve to the path.
  const backlinkCount = (path: string): number =>
    files.filter(
      (f) => f.path !== path && parsed[f.path].links.some((l) => resolve(l.raw) === path)
    ).length
  return tendReport(files, parsed, notes, resolve, backlinkCount, NOW)
}

const FILLER = 'word '.repeat(30) // keeps a note above the stub threshold

describe('suggested connections', () => {
  it('finds unlinked name mentions and lists their sources', () => {
    const r = report({
      'Deep Work.md': FILLER,
      'A.md': `I read Deep Work last week. ${FILLER}`,
      'B.md': `Deep Work changed my mind. ${FILLER}`
    })
    expect(r.suggestions).toHaveLength(1)
    expect(r.suggestions[0].name).toBe('Deep Work')
    expect(r.suggestions[0].sources.sort()).toEqual(['A.md', 'B.md'])
  })

  it('ignores mentions that are already wikilinked, in code, or in connected notes', () => {
    const r = report({
      'Deep Work.md': `See [[Cited]]. ${FILLER}`,
      'Linked.md': `[[Deep Work]] is great. ${FILLER}`,
      'Coded.md': `\`Deep Work\` and\n\`\`\`\nDeep Work\n\`\`\`\n${FILLER}`,
      'Cited.md': `Deep Work links to me already. ${FILLER}` // connected in the other direction
    })
    expect(r.suggestions).toHaveLength(0)
  })

  it('skips short and duplicate basenames, and journal notes as targets', () => {
    const r = report({
      'Go.md': FILLER, // too short to be a safe mention
      'Projects/Plan.md': FILLER,
      'Archive/Plan.md': FILLER, // duplicate basename → ambiguous
      'Daily/2026/07/2026-07-01.md': `Worked on Plan and Go today. ${FILLER}`
    })
    expect(r.suggestions).toHaveLength(0)
  })

  it('counts a journal day as a mention source', () => {
    const r = report({
      'Verso.md': FILLER,
      'Daily/2026/07/2026-07-01.md': `Shipped Verso updates. ${FILLER}`
    })
    expect(r.suggestions.map((s) => s.name)).toEqual(['Verso'])
    expect(r.suggestions[0].sources).toEqual(['Daily/2026/07/2026-07-01.md'])
  })
})

describe('orphans, stubs, stale', () => {
  it('reports notes with no links in or out as orphans', () => {
    const r = report({
      'Alone.md': FILLER,
      'A.md': `links [[B]] ${FILLER}`,
      'B.md': FILLER
    })
    expect(r.orphans.map((f) => f.path)).toEqual(['Alone.md'])
  })

  it('reports short notes as stubs, skipping journal/template/tag notes', () => {
    const r = report({
      'Stub.md': 'just a line',
      'Full.md': FILLER,
      'Templates/Meeting.md': 'tiny',
      'Tags/Person.md': '---\nfields: {}\n---\n',
      'Daily/2026/07/2026-07-01.md': 'short day'
    })
    expect(r.stubs.map((f) => f.path)).toEqual(['Stub.md'])
  })

  it('reports old notes as stale, oldest first', () => {
    const r = report(
      { 'Old.md': FILLER, 'Older.md': FILLER, 'Fresh.md': FILLER },
      { 'Old.md': NOW - 100 * DAY, 'Older.md': NOW - 200 * DAY }
    )
    expect(r.stale.map((f) => f.path)).toEqual(['Older.md', 'Old.md'])
  })
})

describe('broken links', () => {
  it('groups unresolved targets by name with their sources', () => {
    const r = report({
      'A.md': `see [[Missing]] and [[missing]] ${FILLER}`,
      'B.md': `also [[Missing]] ${FILLER}`
    })
    expect(r.broken).toHaveLength(1)
    expect(r.broken[0].raw).toBe('Missing')
    expect(r.broken[0].sources.sort()).toEqual(['A.md', 'B.md'])
  })

  it('ignores asset embeds, date links, and template placeholders', () => {
    const r = report({
      'A.md': `![[gone.png]] and [[2026-12-25]] ${FILLER}`,
      'Templates/T.md': '[[Placeholder]]'
    })
    expect(r.broken).toHaveLength(0)
  })
})
