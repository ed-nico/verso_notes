import { describe, it, expect } from 'vitest'
import { aggregateTodos, clearTodoCache, journalBacklog, overdue } from './todos'

const todosOf = (path: string, text: string) => {
  clearTodoCache()
  return aggregateTodos([{ path, text }])
}

describe('task date resolution', () => {
  it('takes an explicit due token first', () => {
    const [t] = todosOf('A.md', '- [ ] pay rent due:2026-08-01\n')
    expect(t.date).toBe('2026-08-01')
    expect(t.explicit).toBe(true)
    expect(t.text).toBe('pay rent')
  })

  it('schedules by association: a [[YYYY-MM-DD]] link is the due date (kept in text)', () => {
    const [t] = todosOf('A.md', '- [ ] prep slides for [[2026-07-20]] meeting\n')
    expect(t.date).toBe('2026-07-20')
    expect(t.explicit).toBe(true)
    expect(t.text).toContain('[[2026-07-20]]') // the link still works
  })

  it('ignores an impossible date link', () => {
    const [t] = todosOf('A.md', '- [ ] see [[2026-13-45]]\n')
    expect(t.date).toBeNull()
  })

  it('falls back to the journal day, marked implicit', () => {
    const [t] = todosOf('Daily/2026/07/2026-07-01.md', '- [ ] loose end\n')
    expect(t.date).toBe('2026-07-01')
    expect(t.explicit).toBe(false)
  })
})

describe('overdue asymmetry', () => {
  const today = '2026-07-14'
  it('only explicit dates make a task overdue; journal leftovers are backlog', () => {
    const all = [
      ...todosOf('Daily/2026/07/2026-07-01.md', '- [ ] old journal task\n'),
      ...todosOf('B.md', '- [ ] real deadline due:2026-07-10\n')
    ]
    expect(overdue(all, today).map((t) => t.text)).toEqual(['real deadline'])
    expect(journalBacklog(all, today).map((t) => t.text)).toEqual(['old journal task'])
  })
})

describe('breadcrumbs', () => {
  it('carries ancestor list-item labels, newest two', () => {
    const [t] = todosOf('A.md', '- Project\n  - Phase 2\n    - Deep\n      - [ ] ship it\n')
    expect(t.crumbs).toEqual(['Phase 2', 'Deep'])
  })

  it('hides generic Tasks/Todo parents', () => {
    const [t] = todosOf('A.md', '- Website\n  - Todos\n    - [ ] fix header\n')
    expect(t.crumbs).toEqual(['Website'])
  })

  it('resets ancestry across non-list lines', () => {
    const text = '- Project\n\nSome paragraph.\n\n- [ ] standalone\n'
    const t = todosOf('A.md', text).find((x) => x.text === 'standalone')!
    expect(t.crumbs).toEqual([])
  })

  it('a sibling task does not inherit the previous task as a crumb', () => {
    const ts = todosOf('A.md', '- Parent\n  - [ ] first\n  - [ ] second\n')
    expect(ts[1].crumbs).toEqual(['Parent'])
  })
})
