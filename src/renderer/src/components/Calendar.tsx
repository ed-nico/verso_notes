import { useState } from 'react'
import { useStore } from '../store'
import { dailyPath, monthGrid, monthLabel, monthOf, todayISO, WEEKDAY_INITIALS } from '../lib/dates'

/** Mini month calendar. Days with a daily note are dotted; clicking picks a date. */
export function Calendar({ onPick }: { onPick: (iso: string) => void }): React.JSX.Element {
  const today = todayISO()
  const [{ year, month0 }, setMonth] = useState(() => monthOf(today))
  const files = useStore((s) => s.files)
  const hasNote = (iso: string): boolean => files.some((f) => f.path === dailyPath(iso))

  const weeks = monthGrid(year, month0)
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
            <div className={cls} key={iso} onClick={() => onPick(iso)}>
              {Number(iso.slice(8, 10))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
