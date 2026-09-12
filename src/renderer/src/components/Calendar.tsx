import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { dailyPath, formatLong, monthGrid, monthLabel, monthOf, todayISO, WEEKDAY_INITIALS } from '../lib/dates'

/** Mini month calendar. Days with a daily note are dotted; clicking picks a date. */
export function Calendar({ onPick }: { onPick: (iso: string) => void }): React.JSX.Element {
  const today = todayISO()
  const [{ year, month0 }, setMonth] = useState(() => monthOf(today))
  const files = useStore((s) => s.files)
  // A set, not a scan: `hasNote` is asked 42 times per render, and a linear pass
  // over a few thousand files each time is the whole cost of drawing the grid.
  const dailyPaths = useMemo(() => new Set(files.map((f) => f.path)), [files])
  const hasNote = (iso: string): boolean => dailyPaths.has(dailyPath(iso))

  const weeks = monthGrid(year, month0)

  /**
   * Picking a day that already has a note just opens it. Picking an empty one
   * CREATES a file, and the grid is a dense 7x6 target that sits under the
   * pointer all day — a mis-click used to leave a stray blank daily note behind,
   * which then shows up in search, the graph and Tend forever.
   */
  const pick = (iso: string): void => {
    if (!hasNote(iso) && !window.confirm(`No note for ${formatLong(iso)} yet. Create one?`)) return
    onPick(iso)
  }

  const step = (delta: number): void => {
    const m = month0 + delta
    setMonth({ year: year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 })
  }

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => step(-1)}>
          ‹
        </button>
        <span className="cal-title">{monthLabel(year, month0)}</span>
        <button className="cal-nav" onClick={() => step(1)}>
          ›
        </button>
      </div>
      <div className="cal-grid">
        {WEEKDAY_INITIALS.map((d, i) => (
          <div className="cal-dow" key={i}>
            {d}
          </div>
        ))}
        {weeks.flat().map((iso) => {
          const inMonth = Number(iso.slice(5, 7)) - 1 === month0
          const cls =
            'cal-day' +
            (iso === today ? ' today' : '') +
            (inMonth ? '' : ' faint') +
            (hasNote(iso) ? ' has-note' : '')
          return (
            <div
              className={cls}
              key={iso}
              role="button"
              tabIndex={0}
              onClick={() => pick(iso)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pick(iso)
                }
              }}
            >
              {Number(iso.slice(8, 10))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
