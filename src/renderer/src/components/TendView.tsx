import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { tendReport, type Suggestion, type BrokenLink } from '../lib/tend'
import { dirname } from '../lib/links'
import type { NoteFile } from '@shared/types'

/** Most rows shown per section before the "+N more" tail. */
const ROW_CAP = 30

function age(mtime: number, now: number): string {
  const days = Math.floor((now - mtime) / (24 * 60 * 60 * 1000))
  if (days < 60) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months < 24 ? `${months} months ago` : `${Math.floor(months / 12)} years ago`
}

function Section({
  label,
  count,
  hint,
  defaultOpen = false,
  children
}: {
  label: string
  count: number
  hint: string
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen)
  if (count === 0) return null
  return (
    <div className="tend-section">
      <h3 className="bl-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="bl-caret">{open ? '▾' : '▸'}</span>
        {count} {label}
        {count === 1 ? '' : 's'}
        <span className="tend-hint">{hint}</span>
      </h3>
      {open && children}
    </div>
  )
}

/** Clickable note name with its folder as a dim hint. */
function NoteRef({ file }: { file: { path: string; name: string } }): React.JSX.Element {
  const openNote = useStore((s) => s.openNote)
  const dir = dirname(file.path)
  return (
    <span className="tend-note" role="link" tabIndex={0} onClick={() => openNote(file.path)}>
      {file.name}
      {dir && <span className="tend-dir">{dir}</span>}
    </span>
  )
}

function SuggestionRow({ s }: { s: Suggestion }): React.JSX.Element {
  const openNote = useStore((st) => st.openNote)
  const linkAllUnlinked = useStore((st) => st.linkAllUnlinked)
  const files = useStore((st) => st.files)
  const nameOf = (p: string): string => files.find((f) => f.path === p)?.name ?? p
  return (
    <div className="tend-row">
      <NoteRef file={{ path: s.path, name: s.name }} />
      <span className="tend-detail">
        mentioned in{' '}
        {s.sources.slice(0, 4).map((p, i) => (
          <span key={p}>
            {i > 0 && ', '}
            <span className="tend-src" role="link" tabIndex={0} onClick={() => openNote(p)}>
              {nameOf(p)}
            </span>
          </span>
        ))}
        {s.sources.length > 4 && ` +${s.sources.length - 4} more`} — without a link
      </span>
      <button
        className="bl-link-btn"
        title="Turn every mention into a [[link]]"
        onClick={() => void linkAllUnlinked(s.path)}
      >
        ↩ Link all
      </button>
    </div>
  )
}

function BrokenRow({ b }: { b: BrokenLink }): React.JSX.Element {
  const openNote = useStore((st) => st.openNote)
  const navigate = useStore((st) => st.navigate)
  const files = useStore((st) => st.files)
  const nameOf = (p: string): string => files.find((f) => f.path === p)?.name ?? p
  return (
    <div className="tend-row">
      <span className="tend-broken">[[{b.raw}]]</span>
      <span className="tend-detail">
        referenced in{' '}
        {b.sources.slice(0, 4).map((p, i) => (
          <span key={p}>
            {i > 0 && ', '}
            <span className="tend-src" role="link" tabIndex={0} onClick={() => openNote(p)}>
              {nameOf(p)}
            </span>
          </span>
        ))}
        {b.sources.length > 4 && ` +${b.sources.length - 4} more`} — but doesn't exist
      </span>
      <button className="bl-link-btn" title="Create this note" onClick={() => void navigate(b.raw)}>
        ＋ Create
      </button>
    </div>
  )
}

function capped<T>(items: T[], render: (item: T) => React.ReactNode): React.ReactNode {
  return (
    <>
      {items.slice(0, ROW_CAP).map(render)}
      {items.length > ROW_CAP && <div className="tend-more">+{items.length - ROW_CAP} more</div>}
    </>
  )
}

/** The gardener: surfaces connections you haven't made and notes that need care. */
export function TendView(): React.JSX.Element {
  const files = useStore((s) => s.files)
  const index = useStore((s) => s.index)
  const openNote = useStore((s) => s.openNote)

  // The scan is vault-wide, so recompute only when the index generation changes
  // (the view is unmounted when not shown — nothing runs while typing elsewhere).
  const report = useMemo(() => {
    const { parsed, texts } = useStore.getState()
    return tendReport(
      files,
      parsed,
      texts,
      (raw) => index.resolvePath(raw),
      (p) => index.backlinkCount(p),
      Date.now()
    )
  }, [files, index])

  const total =
    report.suggestions.length +
    report.orphans.length +
    report.stubs.length +
    report.stale.length +
    report.broken.length

  const randomNote = (): void => {
    const pool = files.filter((f) => !f.path.startsWith('Templates/') && !f.path.startsWith('Tags/'))
    if (pool.length) openNote(pool[Math.floor(Math.random() * pool.length)].path)
  }

  const noteRow = (f: NoteFile, extra?: string): React.ReactNode => (
    <div className="tend-row" key={f.path}>
      <NoteRef file={f} />
      {extra && <span className="tend-detail">{extra}</span>}
    </div>
  )

  return (
    <div className="scroll-area">
      <div className="doc tend">
        <div className="tend-head">
          <h1>Tend</h1>
          <button className="btn ghost" onClick={randomNote} title="Open a random note — serendipity on demand">
            ⚂ Random note
          </button>
        </div>
        <p className="tend-intro">
          Connections you haven't made yet, and notes that need care. A healthy garden links together.
        </p>
        {total === 0 ? (
          <p className="tend-empty">Nothing to tend — the garden is healthy. 🌿</p>
        ) : (
          <>
            <Section
              label="suggested connection"
              count={report.suggestions.length}
              hint="notes mentioned by name, never linked"
              defaultOpen
            >
              {capped(report.suggestions, (s) => (
                <SuggestionRow key={s.path} s={s} />
              ))}
            </Section>
            <Section label="broken link" count={report.broken.length} hint="wikilinks pointing at nothing" defaultOpen>
              {capped(report.broken, (b) => (
                <BrokenRow key={b.raw} b={b} />
              ))}
            </Section>
            <Section label="orphan" count={report.orphans.length} hint="no links in or out">
              {capped(report.orphans, (f) => noteRow(f))}
            </Section>
            <Section label="stub" count={report.stubs.length} hint="barely any content yet">
              {capped(report.stubs, (f) => noteRow(f))}
            </Section>
            <Section label="stale note" count={report.stale.length} hint="untouched for 90+ days">
              {capped(report.stale, (f) => noteRow(f, age(f.mtime, Date.now())))}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
