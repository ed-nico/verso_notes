import { memo, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { BlockEditor } from './BlockEditor'
import { TodoItem } from './TodoItem'
import { addDays, dailyDateOf, dailyPath, formatLong, todayISO } from '../lib/dates'
import { aggregateTodos, dueOn, overdue, type Todo } from '../lib/todos'
import { hoverLink, unhoverLink } from './LinkPreview'

const BATCH = 7

/** Content equality for small per-day todo lists (identities change every rebuild). */
const sameTodos = (a: Todo[], b: Todo[]): boolean =>
  a.length === b.length &&
  a.every((t, i) => t.id === b[i].id && t.checked === b[i].checked && t.text === b[i].text && t.date === b[i].date)

// Memoized per day: an index rebuild re-derives the vault's todos (new array
// identities), but a day — and its whole BlockEditor — should only re-render
// when ITS scheduled/overdue lists actually changed.
const JournalDay = memo(
  function JournalDay({
    iso,
    today,
    scheduled,
    overdueItems
  }: {
    iso: string
    today: string
    scheduled: Todo[]
    overdueItems: Todo[]
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
  },
  (a, b) =>
    a.iso === b.iso &&
    a.today === b.today &&
    sameTodos(a.scheduled, b.scheduled) &&
    sameTodos(a.overdueItems, b.overdueItems)
)

export function JournalView(): React.JSX.Element {
  const today = todayISO()
  const [count, setCount] = useState(10)
  const [showOtd, setShowOtd] = useState(false)
  // `index`, not `texts`, is the recompute signal: the texts map is mutated in
  // place while typing (same identity — a [texts] memo goes stale), and the index
  // identity changes exactly once per debounced rebuild. aggregateTodos is
  // per-note cached, so each refresh costs O(changed notes), not O(vault).
  const index = useStore((s) => s.index)
  const files = useStore((s) => s.files)
  const parsed = useStore((s) => s.parsed)
  const openNote = useStore((s) => s.openNote)

  const days = useMemo(() => Array.from({ length: count }, (_, i) => addDays(today, -i)), [today, count])
  const todos = useMemo(() => {
    const texts = useStore.getState().texts
    return aggregateTodos(Object.entries(texts).map(([path, text]) => ({ path, text })))
  }, [index])

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
          <JournalDay
            key={iso}
            iso={iso}
            today={today}
            // Todos due this day that live in OTHER notes (a day's own tasks
            // already show inside its editor).
            scheduled={dueOn(todos, iso).filter((t) => t.sourcePath !== dailyPath(iso))}
            overdueItems={iso === today ? overdue(todos, today) : []}
          />
        ))}
      </div>
    </div>
  )
}
