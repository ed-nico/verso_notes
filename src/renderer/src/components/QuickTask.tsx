import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { formatLong, todayISO } from '../lib/dates'

/**
 * Quick capture (⌘⇧T): drop a task into today's daily note from anywhere in the
 * app, without navigating there and losing your place.
 *
 * A one-field bar rather than a full modal on purpose — it is meant to be opened,
 * typed into and dismissed inside a couple of seconds. It stays open on ⌘Enter so
 * a burst of three tasks costs one keystroke each, and reports what it captured
 * so you know the note took it without going to look.
 */
export function QuickTask({ onClose }: { onClose: () => void }): React.JSX.Element {
  const addTaskToToday = useStore((s) => s.addTaskToToday)
  const openNote = useStore((s) => s.openNote)
  const ensureDailyNote = useStore((s) => s.ensureDailyNote)
  const [text, setText] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const submit = async (keepOpen: boolean): Promise<void> => {
    const task = text.trim()
    if (!task || busy) return
    setBusy(true)
    await addTaskToToday(task)
    setBusy(false)
    setText('')
    setAdded((a) => [...a, task])
    if (keepOpen) input.current?.focus()
    else onClose()
  }

  return (
    <div className="modal-overlay qt-overlay" onMouseDown={onClose}>
      <div className="qt-bar" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qt-head">
          <span className="qt-title">Add a task to today</span>
          <span className="qt-date">{formatLong(todayISO())}</span>
        </div>
        <input
          ref={input}
          className="qt-input"
          value={text}
          placeholder="What needs doing?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit(e.metaKey || e.ctrlKey)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        {added.length > 0 && (
          <div className="qt-added">
            {added.map((t, i) => (
              <div className="qt-added-row" key={i}>
                <span className="qt-check">☑</span> {t}
              </div>
            ))}
          </div>
        )}
        <div className="qt-foot">
          <span className="qt-hint">
            <b>↵</b> add · <b>⌘↵</b> add &amp; keep going · <b>esc</b> close
          </span>
          <button
            className="qt-open"
            onClick={() => {
              onClose()
              void ensureDailyNote(todayISO()).then(openNote)
            }}
          >
            Open today ↗
          </button>
        </div>
      </div>
    </div>
  )
}
