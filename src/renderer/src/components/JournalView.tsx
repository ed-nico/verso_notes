import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { BlockEditor } from './BlockEditor'
import { TodoItem } from './TodoItem'
import { addDays, dailyDateOf, dailyPath, formatLong, todayISO } from '../lib/dates'
import { aggregateTodos, dueOn, overdue, type Todo } from '../lib/todos'
import { hoverLink, unhoverLink } from './LinkPreview'

const BATCH = 7

function JournalDay({
  iso,
  today,
  todos
}: {
  iso: string
  today: string
  todos: Todo[]
}): React.JSX.Element {
  const path = dailyPath(iso)
  const openNote = useStore((s) => s.openNote)
  const ensureDailyNote = useStore((s) => s.ensureDailyNote)
  const exists = useStore((s) => s.files.some((f) => f.path === path))
  const isToday = iso === today

  // Materialise today's entry from the Journal template the first time it's shown.
  useEffect(() => {
    if (isToday && !exists) void ensureDailyNote(iso)
  }, [isToday, exists, iso, ensureDailyNote])

  const { scheduled, overdueItems } = useMemo(() => {
    // Todos due this day that live in OTHER notes (this day's own tasks show in its editor).
    const scheduled = dueOn(todos, iso).filter((t) => t.sourcePath !== path)
    const overdueItems = isToday ? overdue(todos, today) : []
    return { scheduled, overdueItems }
  }, [todos, iso, path, isToday, today])

  return (
    <section className="journal-day">
      <div
        className="journal-date"
        role="link"
        tabIndex={0}
        onClick={() => void ensureDailyNote(iso).then(openNote)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void ensureDailyNote(iso).then(openNote)
          }
        }}
      >
        {formatLong(iso)}
        {isToday && <span className="journal-today-chip">Today</span>}
      </div>

      {(overdueItems.length > 0 || scheduled.length > 0) && (
        <div className="journal-scheduled">
          {overdueItems.map((t) => (
            <div className="todo-wrap overdue" key={t.id}>
              <span className="todo-flag">overdue</span>
              <TodoItem todo={t} showDate />
            </div>
          ))}
          {scheduled.map((t) => (
            <TodoItem key={t.id} todo={t} />
          ))}
        </div>
      )}

      <BlockEditor key={path} path={path} />
    </section>
  )
}

export function JournalView(): React.JSX.Element {
  const today = todayISO()
  const [count, setCount] = useState(10)
  const [showOtd, setShowOtd] = useState(false)
  const texts = useStore((s) => s.texts)
  const files = useStore((s) => s.files)
  const parsed = useStore((s) => s.parsed)
  const openNote = useStore((s) => s.openNote)

  const days = useMemo(() => Array.from({ length: count }, (_, i) => addDays(today, -i)), [today, count])
  const todos = useMemo(
    () => aggregateTodos(Object.entries(texts).map(([path, text]) => ({ path, text }))),
    [texts]
  )

  // All daily notes sharing today's month + day (any year, including this one).
  const onThisDay = useMemo(() => {
    const mmdd = today.slice(5)
    return files
      .map((f) => ({ path: f.path, iso: dailyDateOf(f.path) }))
      .filter((x): x is { path: string; iso: string } => !!x.iso && x.iso.slice(5) === mmdd)
      .sort((a, b) => (a.iso < b.iso ? 1 : -1))
  }, [files, today])

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240 && count < 400) {
      setCount((c) => c + BATCH)
    }
  }

  return (
    <div className="scroll-area journal" onScroll={onScroll}>
      <div className="doc journal-doc">
        <div className="journal-header">
          <button
            className={'icon-btn' + (showOtd ? ' active' : '')}
            onClick={() => setShowOtd((v) => !v)}
            title="Entries from this day in other years"
          >
            ↻ On This Day{onThisDay.length ? ` · ${onThisDay.length}` : ''}
          </button>
        </div>

        {showOtd && (
          <div className="otd-panel">
            {onThisDay.length === 0 ? (
              <p className="empty-note">No journal entries on this day yet.</p>
            ) : (
              onThisDay.map(({ path, iso }) => (
                <div
                  className="otd-item"
                  key={path}
                  role="link"
                  tabIndex={0}
                  onClick={() => openNote(path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      openNote(path)
                    }
                  }}
                  onMouseEnter={(e) => hoverLink(path.replace(/\.md$/i, ''), e.clientX, e.clientY)}
                  onMouseLeave={() => unhoverLink()}
                >
                  <span className="otd-date">{formatLong(iso)}</span>
                  <span className="otd-excerpt">{parsed[path]?.excerpt || '—'}</span>
                </div>
              ))
            )}
          </div>
        )}

        {days.map((iso) => (
          <JournalDay key={iso} iso={iso} today={today} todos={todos} />
        ))}
      </div>
    </div>
  )
}
