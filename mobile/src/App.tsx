import { useEffect, useMemo, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { parseBlocks, serializeBlocks } from '@vlib/blocks'
import { resolveTarget, pathForNewNote, dirname } from '@vlib/links'
import { useApp, isNative, DEFAULT_ROOT, vaultIndex } from './state'
import { isStructuredQuery } from '@vlib/query'
import { searchNotes } from '@vlib/search'
import { ScanNote } from './screens'
import { FolderPicker } from './fs'
import { renderInline } from './inline'
import { Drawer, BaseScreen, TodosScreen, JournalScreen } from './screens'
import { BlockView, EmbedHost } from './reader'

/** First-run screen: point the app at the synced vault folder. */
function Setup(): React.JSX.Element {
  const openVault = useApp((s) => s.openVault)
  const error = useApp((s) => s.error)
  const [root, setRoot] = useState(useApp.getState().root)
  const pick = async (): Promise<void> => {
    try {
      const { path } = await FolderPicker.pick()
      setRoot(path)
      await openVault(path)
    } catch {
      /* picker cancelled */
    }
  }
  return (
    <div className="setup">
      <h1>Verso</h1>
      <p>
        Choose the folder your sync app (Nextcloud, Syncthing, FolderSync, …) keeps your notes in.
        {isNative() && ' Grant “All files access” when Android asks — nothing leaves your phone.'}
      </p>
      {isNative() && (
        <button className="primary" onClick={() => void pick()}>
          📁 Choose folder…
        </button>
      )}
      <details className="manual" open={!isNative()}>
        <summary>Or type the path</summary>
        <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder={DEFAULT_ROOT} />
        <button className="primary ghost" onClick={() => void openVault(root.trim() || DEFAULT_ROOT)}>
          Open vault
        </button>
      </details>
      {error && <div className="error">{error}</div>}
    </div>
  )
}

/** The ☰ button that opens the drawer, shared by every main screen's header. */
function MenuButton(): React.JSX.Element {
  const setDrawer = useApp((s) => s.setDrawer)
  return (
    <button className="icon" title="Menu" onClick={() => setDrawer(true)}>
      ☰
    </button>
  )
}

/** Home: search + note list (most recently modified first). */
function List(): React.JSX.Element {
  const files = useApp((s) => s.files)
  const texts = useApp((s) => s.texts)
  const parsed = useApp((s) => s.parsed)
  const openNote = useApp((s) => s.openNote)
  const refresh = useApp((s) => s.refresh)
  const [q, setQ] = useState('')

  // ONE search box, two engines — the same split the desktop makes. Plain words
  // rank by filename and full text (with a snippet); the moment the text uses
  // query syntax (#tag, [[link]], before:, prop:, -not, sort:, limit:) it runs
  // the query language instead. On a phone this matters more than on a desktop:
  // there's no sidebar tree to fall back on when you can't name what you want.
  const isQuery = useMemo(() => isStructuredQuery(q), [q])
  const hits = useMemo(() => {
    const needle = q.trim()
    if (!needle) return files.map((f) => ({ path: f.path, name: f.name, snippet: '' }))
    if (isQuery) {
      const raw = /(^|\s)scope:/i.test(needle) ? needle : `${needle} scope:notes`
      const rows = vaultIndex(parsed, texts).runQuery(raw).notes ?? []
      return rows.slice(0, 200).map((n) => ({ path: n.path, name: n.name, snippet: n.excerpt }))
    }
    return searchNotes(needle, files, texts, 80, { parsed }).map((h) => ({
      path: h.path,
      name: h.name,
      snippet: h.snippet
    }))
  }, [files, texts, parsed, q, isQuery])

  return (
    <div className="screen">
      <header>
        <MenuButton />
        <input
          className={'search' + (isQuery ? ' is-query' : '')}
          placeholder="Search — or #tag, before:, prop:…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="icon" title="Refresh" onClick={() => void refresh()}>
          ⟳
        </button>
      </header>
      <ScanNote what="More notes are still being read." />
      {isQuery && q.trim() && (
        <div className="search-mode">
          Query · {hits.length} {hits.length === 1 ? 'note' : 'notes'}
        </div>
      )}
      <div className="list">
        {hits.map((h) => (
          <div key={h.path} className="row" onClick={() => void openNote(h.path)}>
            <div className="row-name">{h.name}</div>
            {h.snippet && <div className="row-snippet">{h.snippet}</div>}
            {h.path.includes('/') && <div className="row-dir">{dirname(h.path)}</div>}
          </div>
        ))}
        {hits.length === 0 && (
          <div className="empty">
            {!q ? 'No notes yet.' : isQuery ? 'No notes match this query. Try removing a term — within a group every term must match.' : 'No notes match.'}
          </div>
        )}
      </div>
      <Capture />
    </div>
  )
}

/** FAB + sheet: append a timestamped bullet to today's journal. */
function Capture(): React.JSX.Element {
  const captureToJournal = useApp((s) => s.captureToJournal)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const add = async (): Promise<void> => {
    await captureToJournal(text)
    setText('')
    setOpen(false)
  }
  return (
    <>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <textarea
              autoFocus
              placeholder="Quick note → today's journal"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="primary" disabled={!text.trim()} onClick={() => void add()}>
              Add to journal
            </button>
          </div>
        </div>
      )}
      <button className="fab" title="Quick capture" onClick={() => setOpen(true)}>
        ＋
      </button>
    </>
  )
}

/** Reader + editor for the note on top of the nav stack. */
function Note({ path }: { path: string }): React.JSX.Element {
  const text = useApp((s) => s.texts[path] ?? '')
  const files = useApp((s) => s.files)
  const editing = useApp((s) => s.editing)
  const setEditing = useApp((s) => s.setEditing)
  const saveNote = useApp((s) => s.saveNote)
  const openNote = useApp((s) => s.openNote)
  const back = useApp((s) => s.back)
  const [draft, setDraft] = useState(text)
  const draftRef = useRef(draft)
  draftRef.current = draft
  useEffect(() => setDraft(text), [text, editing])

  const { blocks, frontmatter } = useMemo(() => parseBlocks(text), [text])
  const name = path.replace(/\.md$/i, '').split('/').pop()

  const onWikilink = (target: string): void => {
    const hit = resolveTarget(target, files.map((f) => f.path))
    void openNote(hit ?? pathForNewNote(target))
  }
  const onToggleTask = (id: number): void => {
    const next = blocks.map((b) => (b.id === id && b.type === 'task' ? { ...b, checked: !b.checked } : b))
    void saveNote(path, serializeBlocks(next, frontmatter))
  }
  const finishEdit = (): void => {
    if (draftRef.current !== text) void saveNote(path, draftRef.current)
    setEditing(false)
  }

  return (
    <div className="screen">
      <header>
        <button className="icon" onClick={back}>
          ←
        </button>
        <div className="title">{name}</div>
        {editing ? (
          <button className="icon accent" onClick={finishEdit}>
            ✓
          </button>
        ) : (
          <button className="icon" onClick={() => setEditing(true)}>
            ✎
          </button>
        )}
      </header>
      {editing ? (
        <textarea className="editor" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      ) : (
        <div className="reader" onClick={(e) => e.target === e.currentTarget && setEditing(true)}>
          {/* The chain starts at THIS note, which is what refuses `![[Self]]`. */}
          <EmbedHost value={[path]}>
            {blocks.map((b) => (
              <BlockView key={b.id} b={b} onWikilink={onWikilink} onToggleTask={onToggleTask} />
            ))}
          </EmbedHost>
          {blocks.length === 0 && <div className="empty">Empty note — tap ✎ to write.</div>}
        </div>
      )}
    </div>
  )
}

/** Main screen for the current view when no note is open. */
function ViewScreen(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const bases = useApp((s) => s.bases)
  const activeBaseId = useApp((s) => s.activeBaseId)
  if (view === 'todos') {
    return (
      <div className="screen">
        <header>
          <MenuButton />
          <div className="title">Todos</div>
        </header>
        <TodosScreen />
      </div>
    )
  }
  if (view === 'journal') {
    return (
      <div className="screen">
        <header>
          <MenuButton />
          <div className="title">Journal</div>
        </header>
        <JournalScreen />
        <Capture />
      </div>
    )
  }
  if (view === 'base') {
    const base = bases.find((b) => b.id === activeBaseId) ?? bases[0]
    if (base) {
      return (
        <div className="screen">
          <header>
            <MenuButton />
            <div className="title">▦ {base.name}</div>
          </header>
          <BaseScreen base={base} />
        </div>
      )
    }
  }
  return <List />
}

export default function App(): React.JSX.Element {
  const fs = useApp((s) => s.fs)
  const stack = useApp((s) => s.stack)
  const back = useApp((s) => s.back)
  const error = useApp((s) => s.error)

  // Android hardware back: close the drawer, pop the note stack, else background.
  useEffect(() => {
    if (!isNative()) return
    const sub = CapApp.addListener('backButton', () => {
      const s = useApp.getState()
      if (s.drawerOpen) s.setDrawer(false)
      else if (s.stack.length) back()
      else if (s.view !== 'notes') s.openView('notes')
      else void CapApp.minimizeApp()
    })
    return () => void sub.then((s) => s.remove())
  }, [back])

  // Browser dev: open the shim vault automatically.
  useEffect(() => {
    if (!fs && !isNative()) void useApp.getState().openVault(DEFAULT_ROOT)
  }, [fs])

  // Swipe in from the left edge to open the drawer (like the desktop sidebar).
  const edgeTouch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0]
    edgeTouch.current = t.clientX < 32 ? { x: t.clientX, y: t.clientY } : null
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    const start = edgeTouch.current
    if (!start) return
    const t = e.touches[0]
    if (t.clientX - start.x > 48 && Math.abs(t.clientY - start.y) < 60) {
      edgeTouch.current = null
      useApp.getState().setDrawer(true)
    }
  }

  if (!fs) return <Setup />
  const top = stack[stack.length - 1]
  return (
    <div className="app-root" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
      {top ? <Note key={top + ':' + stack.length} path={top} /> : <ViewScreen />}
      <Drawer />
      {error && (
        <div className="toast" onClick={() => useApp.setState({ error: null })}>
          {error}
        </div>
      )}
    </div>
  )
}
