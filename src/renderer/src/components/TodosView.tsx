import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { TodoItem } from './TodoItem'
import { aggregateTodos, sortByDate, type Todo } from '../lib/todos'
import { formatLong, todayISO } from '../lib/dates'

function Group({ title, todos, showDate }: { title: string; todos: Todo[]; showDate?: boolean }): React.JSX.Element | null {
  if (todos.length === 0) return null
  return (
    <div className="todo-group">
      <h3 className="todo-group-title">
        {title} <span className="todo-count">{todos.length}</span>
      </h3>
      {todos.map((t) => (
        <TodoItem key={t.id} todo={t} showDate={showDate} />
      ))}
    </div>
  )
}

/** Things-style shelves across the top: one slice of the task list at a time. */
type Shelf = 'all' | 'today' | 'upcoming' | 'someday' | 'logbook'

export function TodosView(): React.JSX.Element {
  // Recompute on the debounced index rebuild, NOT on `texts`: the texts map is
  // mutated in place on the typing hot path (same identity), so a [texts] memo
  // both goes stale after edits and re-scans the vault when it does fire. The
  // index identity changes exactly when derived state should refresh, and
  // aggregateTodos is per-note cached, so each refresh is O(changed notes).
  const index = useStore((s) => s.index)
  const today = todayISO()
  const [shelf, setShelf] = useState<Shelf>('all')

  const { overdueG, backlogG, todayG, upcoming, someday, done } = useMemo(() => {
    const texts = useStore.getState().texts
    const all = aggregateTodos(Object.entries(texts).map(([path, text]) => ({ path, text })))
    const open = all.filter((t) => !t.checked)
    // Only EXPLICIT dates make a task overdue; a bare checkbox in an old daily
    // note is backlog, not lateness (it would otherwise drown real deadlines).
    const overdueG = sortByDate(open.filter((t) => t.explicit && t.date && t.date < today))
    const backlogG = sortByDate(open.filter((t) => !t.explicit && t.date && t.date < today))
    const todayG = open.filter((t) => t.date === today)
    const future = sortByDate(open.filter((t) => t.date && t.date > today))
    // group upcoming by date
    const upcoming: { date: string; todos: Todo[] }[] = []
    for (const t of future) {
      const last = upcoming[upcoming.length - 1]
      if (last && last.date === t.date) last.todos.push(t)
      else upcoming.push({ date: t.date!, todos: [t] })
    }
    const someday = open.filter((t) => !t.date)
    const done = all.filter((t) => t.checked)
    return { overdueG, backlogG, todayG, upcoming, someday, done }
  }, [index, today])

  const upcomingCount = upcoming.reduce((n, g) => n + g.todos.length, 0)
  const counts: Record<Shelf, number> = {
    all: overdueG.length + backlogG.length + todayG.length + upcomingCount + someday.length,
    today: overdueG.length + todayG.length, // overdue belongs to Today, Things-style
    upcoming: upcomingCount,
    someday: someday.length + backlogG.length,
    logbook: done.length
  }
  const SHELVES: { key: Shelf; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'someday', label: 'Someday' },
    { key: 'logbook', label: 'Logbook' }
  ]

  const show = (s: Shelf): boolean => shelf === s || (shelf === 'all' && s !== 'logbook')

  return (
    <div className="scroll-area">
      <div className="doc todos-doc">
        <div className="todos-head">
          <h1>Todos</h1>
        </div>

        <div className="todo-shelves">
          {SHELVES.map((s) => (
            <button
              key={s.key}
              className={'shelf-btn' + (shelf === s.key ? ' active' : '')}
              onClick={() => setShelf(s.key)}
            >
              {s.label}
              {counts[s.key] > 0 && <span className="shelf-count">{counts[s.key]}</span>}
            </button>
          ))}
        </div>

        {counts[shelf] === 0 && (
          <p className="empty-note">
            {shelf === 'logbook' ? 'Nothing completed yet.' : 'Nothing here. Nice and clear.'}
          </p>
        )}

        {show('today') && <Group title="⚠ Overdue" todos={overdueG} showDate />}
        {show('today') && <Group title="Today" todos={todayG} />}
        {show('upcoming') &&
          upcoming.map((g) => <Group key={g.date} title={formatLong(g.date)} todos={g.todos} />)}
        {show('someday') && <Group title="Someday" todos={someday} />}
        {show('someday') && <Group title="From older journals" todos={backlogG} showDate />}
        {show('logbook') && <Group title="Completed" todos={done} showDate />}
      </div>
    </div>
  )
}
