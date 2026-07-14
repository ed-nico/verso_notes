import { Fragment, useMemo, useState } from 'react'
import type { NoteFile, ParsedNote } from '@shared/types'
import { parseBlocks, serializeBlocks, type Block } from '@vlib/blocks'
import { passesFilter, type Base } from '@vlib/bases'
import { normTag } from '@vlib/supertags'
import { dailyDateOf, formatLong, todayISO } from '@vlib/dates'
import { resolveTarget, pathForNewNote } from '@vlib/links'
import { useApp } from './state'
import { BlockView } from './reader'

// ---------------------------------------------------------------------------
// Folder tree (drawer) — same shape as the desktop sidebar's file tree.
// ---------------------------------------------------------------------------

interface TreeDir {
  name: string
  path: string
  dirs: TreeDir[]
  notes: NoteFile[]
}

function buildTree(files: NoteFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], notes: [] }
  const dirOf = new Map<string, TreeDir>([['', root]])
  const ensureDir = (path: string): TreeDir => {
    const hit = dirOf.get(path)
    if (hit) return hit
    const parent = ensureDir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    const dir: TreeDir = { name: path.split('/').pop()!, path, dirs: [], notes: [] }
    parent.dirs.push(dir)
    dirOf.set(path, dir)
    return dir
  }
  for (const f of files) {
    const dir = f.path.includes('/') ? ensureDir(f.path.slice(0, f.path.lastIndexOf('/'))) : root
    dir.notes.push(f)
  }
  const sortDir = (d: TreeDir): void => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name))
    d.notes.sort((a, b) => a.name.localeCompare(b.name))
    d.dirs.forEach(sortDir)
  }
  sortDir(root)
  return root
}

function DirRow({ dir, depth, open, toggle }: { dir: TreeDir; depth: number; open: Set<string>; toggle: (p: string) => void }): React.JSX.Element {
  const openNote = useApp((s) => s.openNote)
  const expanded = open.has(dir.path)
  return (
    <>
      <div className="tree-row dir" style={{ paddingLeft: 14 + depth * 14 }} onClick={() => toggle(dir.path)}>
        <span className="tree-chevron">{expanded ? '▾' : '▸'}</span> 📁 {dir.name}
      </div>
      {expanded && (
        <>
          {dir.dirs.map((d) => (
            <DirRow key={d.path} dir={d} depth={depth + 1} open={open} toggle={toggle} />
          ))}
          {dir.notes.map((n) => (
            <div key={n.path} className="tree-row" style={{ paddingLeft: 30 + depth * 14 }} onClick={() => void openNote(n.path)}>
              {n.name}
            </div>
          ))}
        </>
      )}
    </>
  )
}

export function Drawer(): React.JSX.Element {
  const files = useApp((s) => s.files)
  const bases = useApp((s) => s.bases)
  const root = useApp((s) => s.root)
  const drawerOpen = useApp((s) => s.drawerOpen)
  const setDrawer = useApp((s) => s.setDrawer)
  const openView = useApp((s) => s.openView)
  const openNote = useApp((s) => s.openNote)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const tree = useMemo(() => buildTree(files), [files])
  const toggle = (p: string): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  // Swipe left anywhere on the drawer closes it.
  const touch = { x: 0 }
  return (
    <>
      <div className={'drawer-backdrop' + (drawerOpen ? ' show' : '')} onClick={() => setDrawer(false)} />
      <nav
        className={'drawer' + (drawerOpen ? ' show' : '')}
        onTouchStart={(e) => (touch.x = e.touches[0].clientX)}
        onTouchEnd={(e) => e.changedTouches[0].clientX - touch.x < -50 && setDrawer(false)}
      >
        <div className="drawer-head">{root.split('/').pop() || 'vault'}</div>
        <div className="drawer-nav">
          <div className="nav-item" onClick={() => openView('notes')}>🗒 Notes</div>
          <div className="nav-item" onClick={() => openView('journal')}>☀ Journal</div>
          <div className="nav-item" onClick={() => openView('todos')}>✓ Todos</div>
        </div>
        {bases.length > 0 && (
          <>
            <div className="drawer-label">Bases</div>
            {bases.map((b) => (
              <div key={b.id} className="nav-item" onClick={() => openView('base', b.id)}>
                ▦ {b.name}
              </div>
            ))}
          </>
        )}
        <div className="drawer-label">Files</div>
        <div className="drawer-tree">
          {tree.dirs.map((d) => (
            <DirRow key={d.path} dir={d} depth={0} open={open} toggle={toggle} />
          ))}
          {tree.notes.map((n) => (
            <div key={n.path} className="tree-row" style={{ paddingLeft: 16 }} onClick={() => void openNote(n.path)}>
              {n.name}
            </div>
          ))}
        </div>
      </nav>
    </>
  )
}

// ---------------------------------------------------------------------------
// Bases — rows computed with the desktop lib's filter semantics.
// ---------------------------------------------------------------------------

function cellValue(n: ParsedNote, key: string): unknown {
  if (key === 'name') return n.name
  if (key === 'tags') return n.tags.join(', ')
  return n.frontmatter[key]
}

export function baseRows(base: Base, parsed: Record<string, ParsedNote>): ParsedNote[] {
  let rows = Object.values(parsed)
  if (base.folder) rows = rows.filter((n) => n.path.startsWith(base.folder))
  if (base.tag) rows = rows.filter((n) => n.tags.some((t) => normTag(t) === normTag(base.tag)))
  rows = rows.filter((n) => base.filters.every((f) => passesFilter(cellValue(n, f.key), f)))
  const dir = base.sortDir === 'desc' ? -1 : 1
  const key = base.sortKey || 'name'
  rows.sort((a, b) => {
    const va = cellValue(a, key)
    const vb = cellValue(b, key)
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va ?? '').localeCompare(String(vb ?? '')) * dir
  })
  return rows
}

export function BaseScreen({ base }: { base: Base }): React.JSX.Element {
  const parsed = useApp((s) => s.parsed)
  const scanning = useApp((s) => s.scanning)
  const openNote = useApp((s) => s.openNote)
  const rows = useMemo(() => baseRows(base, parsed), [base, parsed])
  const cols = ['name', ...base.columns.filter((c) => c !== 'name' && c !== 'cover' && c !== 'backlinks')]
  const groups = useMemo(() => {
    if (!base.groupKey) return [{ label: '', rows }]
    const by = new Map<string, ParsedNote[]>()
    for (const r of rows) {
      const k = String(cellValue(r, base.groupKey) ?? '—')
      by.set(k, [...(by.get(k) ?? []), r])
    }
    return [...by.entries()].map(([label, rows]) => ({ label, rows }))
  }, [rows, base.groupKey])

  if (scanning && rows.length === 0) return <div className="empty">Scanning vault…</div>
  if (!scanning && rows.length === 0) return <div className="empty">No notes match this base.</div>
  return (
    <div className="db-scroll">
      <table className="db-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.label}>
              {g.label && (
                <tr className="db-group">
                  <td colSpan={cols.length}>{g.label}</td>
                </tr>
              )}
              {g.rows.map((n) => (
                <tr key={n.path} onClick={() => void openNote(n.path)}>
                  {cols.map((c) => {
                    const v = cellValue(n, c)
                    return (
                      <td key={c} className={c === 'name' ? 'db-title' : ''}>
                        {v == null || v === '' ? '' : String(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Journal — a scrollable feed of daily notes, newest first (like the desktop
// journal, phone-shaped). Scroll down to reach previous days.
// ---------------------------------------------------------------------------

function DaySection({ path, date }: { path: string; date: string }): React.JSX.Element {
  const text = useApp((s) => s.texts[path] ?? '')
  const files = useApp((s) => s.files)
  const openNote = useApp((s) => s.openNote)
  const saveNote = useApp((s) => s.saveNote)
  const doc = useMemo(() => parseBlocks(text), [text])
  const onWikilink = (target: string): void => {
    const hit = resolveTarget(target, files.map((f) => f.path))
    void openNote(hit ?? pathForNewNote(target))
  }
  const onToggleTask = (id: number): void => {
    const next = doc.blocks.map((b) => (b.id === id && b.type === 'task' ? { ...b, checked: !b.checked } : b))
    void saveNote(path, serializeBlocks(next, doc.frontmatter))
  }
  return (
    <section className="day">
      <div className="day-head" onClick={() => void openNote(path)}>
        {formatLong(date)}
        {date === todayISO() && <span className="day-today">today</span>}
        <span className="day-edit">✎</span>
      </div>
      <div className="day-body">
        {doc.blocks.map((b) => (
          <BlockView key={b.id} b={b} onWikilink={onWikilink} onToggleTask={onToggleTask} />
        ))}
        {doc.blocks.length === 0 && <div className="empty small">Empty day.</div>}
      </div>
    </section>
  )
}

export function JournalScreen(): React.JSX.Element {
  const files = useApp((s) => s.files)
  const openJournal = useApp((s) => s.openJournal)
  const [limit, setLimit] = useState(14)
  const days = useMemo(
    () =>
      files
        .map((f) => ({ path: f.path, date: dailyDateOf(f.path) }))
        .filter((d): d is { path: string; date: string } => d.date !== null)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [files]
  )
  const hasToday = days[0]?.date === todayISO()
  const grow = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 500) setLimit((l) => (l < days.length ? l + 14 : l))
  }
  return (
    <div className="list journal" onScroll={grow}>
      {!hasToday && (
        <div className="day-head start-today" onClick={() => void openJournal()}>
          ＋ Start today&rsquo;s entry — {formatLong(todayISO())}
        </div>
      )}
      {days.slice(0, limit).map((d) => (
        <DaySection key={d.path} path={d.path} date={d.date} />
      ))}
      {days.length === 0 && <div className="empty">No journal entries yet — use ＋ to capture one.</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Todos — open tasks across the vault, tap to complete (writes markdown back).
// ---------------------------------------------------------------------------

interface TodoItem {
  path: string
  name: string
  blockId: number
  text: string
  checked: boolean
}

export function TodosScreen(): React.JSX.Element {
  const texts = useApp((s) => s.texts)
  const files = useApp((s) => s.files)
  const scanning = useApp((s) => s.scanning)
  const saveNote = useApp((s) => s.saveNote)
  const openNote = useApp((s) => s.openNote)

  const { todos, blocksByPath } = useMemo(() => {
    const todos: TodoItem[] = []
    const blocksByPath = new Map<string, { blocks: Block[]; frontmatter: string }>()
    for (const f of files) {
      const text = texts[f.path]
      if (!text || !/- \[ \]/.test(text)) continue
      const doc = parseBlocks(text)
      blocksByPath.set(f.path, doc)
      for (const b of doc.blocks) {
        if (b.type === 'task' && !b.checked) {
          todos.push({ path: f.path, name: f.name, blockId: b.id, text: b.text, checked: false })
        }
      }
    }
    return { todos, blocksByPath }
  }, [texts, files])

  const complete = (t: TodoItem): void => {
    const doc = blocksByPath.get(t.path)
    if (!doc) return
    const next = doc.blocks.map((b) => (b.id === t.blockId ? { ...b, checked: true } : b))
    void saveNote(t.path, serializeBlocks(next, doc.frontmatter))
  }

  const byNote = useMemo(() => {
    const by = new Map<string, TodoItem[]>()
    for (const t of todos) by.set(t.path, [...(by.get(t.path) ?? []), t])
    return [...by.entries()]
  }, [todos])

  return (
    <div className="list">
      {scanning && todos.length === 0 && <div className="empty">Scanning vault…</div>}
      {byNote.map(([path, items]) => (
        <div key={path}>
          <div className="group-head" onClick={() => void openNote(path)}>
            {items[0].name}
          </div>
          {items.map((t) => (
            <label key={t.blockId} className="todo-row">
              <input type="checkbox" checked={false} onChange={() => complete(t)} />
              <span>{t.text}</span>
            </label>
          ))}
        </div>
      ))}
      {!scanning && todos.length === 0 && <div className="empty">Nothing to do 🎉</div>}
    </div>
  )
}
