import { memo, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { BlockEditor } from './BlockEditor'
import { FormatBar } from './FormatBar'
import { TodoItem } from './TodoItem'
import { addDays, dailyPath, formatLong, todayISO } from '../lib/dates'
import { aggregateTodos, dueOn, overdue, type Todo } from '../lib/todos'

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

        <BlockEditor key={path} path={path} toolbar="none" />
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
  // `index`, not `texts`, is the recompute signal: the texts map is mutated in
  // place while typing (same identity — a [texts] memo goes stale), and the index
  // identity changes exactly once per debounced rebuild. aggregateTodos is
  // per-note cached, so each refresh costs O(changed notes), not O(vault).
  const index = useStore((s) => s.index)

  const days = useMemo(() => Array.from({ length: count }, (_, i) => addDays(today, -i)), [today, count])
  const todos = useMemo(() => {
    const texts = useStore.getState().texts
    return aggregateTodos(texts)
    // `index` is the intended trigger, not an unused dep: `texts` is mutated in
    // place while typing, so a new index identity is the signal that the debounced
    // rebuild has landed and the todo aggregate is worth recomputing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240 && count < 400) {
      setCount((c) => c + BATCH)
    }
  }

  return (
    <div className="scroll-area journal" onScroll={onScroll}>
      <div className="doc journal-doc">
        {/* ONE bar for the whole page. Each day is its own BlockEditor, so a bar
            per editor would repeat down the entire scroll; this one follows
            whichever day has the caret (see lib/formatbus). Rendered as a DIRECT
            child so its `position: sticky` spans the whole document — inside a
            wrapper it would scroll away with that wrapper's short box. */}
        <FormatBar />
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
