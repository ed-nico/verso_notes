import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, templatesFromFiles } from '../store'
import { dirname } from '../lib/links'
import { fuzzyScore, searchNotes } from '../lib/search'
import { REVEAL_LABEL } from '../lib/platform'

interface Item {
  id: string
  label: string
  hint?: string
  /** Keyboard shortcut, shown right-aligned. Putting it here rather than inside
   *  the label is what lets the palette double as the app's shortcut sheet: every
   *  command that has one shows it, in one column, every time you open it. */
  keys?: string
  icon: string
  /** Section heading shown above the first item carrying it. */
  group?: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  const setPalette = useStore((s) => s.setPalette)
  const files = useStore((s) => s.files)
  const history = useStore((s) => s.history)
  const activePath = useStore((s) => s.activePath)
  const templates = useMemo(() => templatesFromFiles(files), [files])
  const openNote = useStore((s) => s.openNote)
  const navigate = useStore((s) => s.navigate)
  const openView = useStore((s) => s.openView)
  const openTag = useStore((s) => s.openTag)
  const openModal = useStore((s) => s.openModal)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const toggleZen = useStore((s) => s.toggleZen)
  const togglePin = useStore((s) => s.togglePin)
  const duplicateNote = useStore((s) => s.duplicateNote)
  const revealNote = useStore((s) => s.revealNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const isPinned = useStore(
    (s) => !!(s.activePath && (s.parsed[s.activePath]?.frontmatter as { pinned?: unknown } | undefined)?.pinned)
  )
  const newFromTemplate = useStore((s) => s.newFromTemplate)
  const reloadVault = useStore((s) => s.reloadVault)

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      // focus after mount
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const close = (): void => setPalette(false)
  const act = (fn: () => void): void => {
    close()
    fn()
  }

  const uniqueUntitled = (): string => {
    const taken = new Set(files.map((f) => f.path.toLowerCase()))
    let name = 'Untitled.md'
    let i = 1
    while (taken.has(name.toLowerCase())) name = `Untitled ${i++}.md`
    return name.replace(/\.md$/i, '')
  }

  const commands: Item[] = useMemo(() => {
    const nameOf = (p: string): string => files.find((f) => f.path === p)?.name ?? p.replace(/\.md$/i, '')
    // Actions on the note you're looking at come FIRST: the palette is meant to be
    // the one way in, and "do something to this note" was the job it couldn't do.
    const forNote: Item[] = activePath
      ? [
          {
            id: 'note-side',
            label: 'Open this note beside the current one',
            icon: '◫',
            group: 'This note',
            run: () => act(() => openInSidePane(activePath))
          },
          {
            id: 'note-pin',
            label: isPinned ? 'Unpin this note' : 'Pin this note to the top',
            icon: '★',
            group: 'This note',
            run: () => act(() => void togglePin(activePath))
          },
          {
            id: 'note-dup',
            label: 'Duplicate this note',
            icon: '⧉',
            group: 'This note',
            run: () => act(() => void duplicateNote(activePath))
          },
          {
            id: 'note-copy-link',
            label: 'Copy a [[link]] to this note',
            icon: '⧉',
            group: 'This note',
            run: () => act(() => void navigator.clipboard.writeText(`[[${nameOf(activePath)}]]`))
          },
          {
            id: 'compile',
            label: 'Compile note from its links…',
            icon: '⧉',
            group: 'This note',
            run: () => act(() => openModal('compile'))
          },
          {
            id: 'export-pdf',
            label: 'Export note as PDF…',
            icon: '⤓',
            group: 'This note',
            run: () =>
              act(() =>
                void useStore
                  .getState()
                  .saveActive()
                  .then(() => window.verso.exportPdf(activePath.replace(/\.md$/i, '').split('/').pop() ?? 'note'))
              )
          },
          {
            id: 'note-reveal',
            label: REVEAL_LABEL,
            icon: '⌕',
            group: 'This note',
            run: () => act(() => void revealNote(activePath))
          },
          {
            id: 'note-delete',
            label: 'Move this note to the Trash…',
            icon: '⌫',
            group: 'This note',
            run: () =>
              act(() => {
                if (window.confirm(`Move “${nameOf(activePath)}” to the Trash?`)) void deleteNote(activePath)
              })
          }
        ]
      : []
    return [
      ...forNote,
      { id: 'new', label: 'New note', icon: '＋', group: 'Create', run: () => act(() => void navigate(uniqueUntitled())) },
      ...templates.map((t) => ({
        id: `tmpl:${t.path}`,
        label: `New from template: ${t.name}`,
        icon: '▤',
        group: 'Create',
        run: () => act(() => void newFromTemplate(t.path))
      })),
      {
        id: 'task-today',
        label: 'Add a task to today',
        keys: '⌘⇧T',
        icon: '✓',
        group: 'Create',
        run: () => act(() => openModal('task'))
      },
      { id: 'journal', label: 'Open Journal', keys: '⌘D', icon: '☼', group: 'Go to', run: () => act(() => openView('journal')) },
      { id: 'todos', label: 'Open Todos', icon: '✓', group: 'Go to', run: () => act(() => openView('todos')) },
      { id: 'graph', label: 'Open Graph', icon: '⦿', group: 'Go to', run: () => act(() => openView('graph')) },
      { id: 'bases', label: 'Open Bases', icon: '▦', group: 'Go to', run: () => act(() => openView('database')) },
      { id: 'tags', label: 'Open Tags', icon: '#', group: 'Go to', run: () => act(() => openTag(null)) },
      { id: 'tend', label: 'Open Tend — suggested links & vault gardening', icon: '❧', group: 'Go to', run: () => act(() => openView('tend')) },
      { id: 'assets', label: 'Open Assets', icon: '⧉', group: 'Go to', run: () => act(() => openView('assets')) },
      { id: 'zen', label: 'Zen mode — hide everything but the note', keys: '⌘⌥\\', icon: '◻', group: 'View', run: () => act(() => toggleZen()) },
      { id: 'sidebar', label: 'Toggle the sidebar', keys: '⌘\\', icon: '◧', group: 'View', run: () => act(() => useStore.getState().toggleSidebar()) },
      { id: 'rightbar', label: 'Toggle the right panel', keys: '⌘⇧\\', icon: '◨', group: 'View', run: () => act(() => useStore.getState().toggleRightbar()) },
      { id: 'theme', label: 'Cycle theme (dark / paper / light)', icon: '☾', group: 'View', run: () => act(() => toggleTheme()) },
      { id: 'reload', label: 'Reload / re-scan vault folder', icon: '⟳', group: 'App', run: () => act(() => void reloadVault()) },
      { id: 'settings', label: 'Open Settings', icon: '⚙', group: 'App', run: () => act(() => openModal('settings')) },
      { id: 'help', label: 'Open Help & shortcuts', icon: '?', group: 'App', run: () => act(() => openModal('help')) }
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, files, activePath, isPinned])

  // Most-recently-opened notes (deduped, newest first), for the empty-query view.
  const recent: Item[] = useMemo(() => {
    const seen = new Set<string>()
    const out: Item[] = []
    for (let i = history.length - 1; i >= 0 && out.length < 7; i--) {
      const e = history[i]
      if (e.kind !== 'note') continue
      const p = e.path
      if (p === activePath || seen.has(p)) continue
      seen.add(p)
      const f = files.find((x) => x.path === p)
      if (!f) continue
      out.push({ id: `recent:${p}`, label: f.name, hint: dirname(p), icon: '◷', group: 'Recent', run: () => act(() => openNote(p)) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, activePath, files])

  const items: Item[] = useMemo(() => {
    const q = query.trim()
    if (!q) return [...recent, ...commands]
    const cmdHits = commands
      .map((c) => ({ c, s: fuzzyScore(q, c.label) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
    // Read `texts` imperatively: the map is mutated in place while typing, so a
    // subscription would never fire anyway — and the palette already re-renders
    // on every query keystroke, which is exactly when this needs to be fresh.
    const noteHits: Item[] = searchNotes(q, files, useStore.getState().texts, 12, {
      aliasOf: (p) => useStore.getState().parsed[p]?.aliases ?? [],
      parsed: useStore.getState().parsed
    }).map((h) => ({
      id: `note:${h.path}`,
      label: h.name,
      hint: h.snippet || h.path,
      icon: '▢',
      group: 'Notes',
      run: () => act(() => openNote(h.path))
    }))
    const create: Item[] = files.some((f) => f.name.toLowerCase() === q.toLowerCase())
      ? []
      : [{ id: 'create', label: `Create note “${q}”`, icon: '＋', run: () => act(() => void navigate(q)) }]
    return [...cmdHits, ...noteHits, ...create]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commands, recent, files])

  useEffect(() => {
    if (sel >= items.length) setSel(Math.max(0, items.length - 1))
  }, [items.length, sel])

  // True when the selection last moved by keyboard — only then do we auto-scroll
  // (scrolling on hover-driven selection would fight the user's mouse wheel).
  // Must be declared before the early return: hooks can't be conditional.
  const kbdNav = useRef(false)

  if (!open) return null
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') return e.preventDefault(), close()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      kbdNav.current = true
      return setSel((s) => Math.min(items.length - 1, s + 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      kbdNav.current = true
      return setSel((s) => Math.max(0, s - 1))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      items[sel]?.run()
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search notes or run a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSel(0)
          }}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {items.length === 0 && <div className="palette-empty">No matches</div>}
          {items.map((it, i) => (
            <div key={'w:' + it.id}>
              {/* A heading whenever the group changes — with note actions, commands
                  and search results in one list, unlabelled runs read as noise. */}
              {it.group && it.group !== items[i - 1]?.group && <div className="palette-group">{it.group}</div>}
            <div
              key={it.id}
              className={'palette-item' + (i === sel ? ' sel' : '')}
              // Keep the keyboard selection in view — the list is scrollable and
              // arrow-key users otherwise lose the highlight below the fold.
              ref={
                i === sel
                  ? (el) => {
                      if (kbdNav.current) el?.scrollIntoView({ block: 'nearest' })
                    }
                  : undefined
              }
              onMouseEnter={() => {
                kbdNav.current = false
                setSel(i)
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                it.run()
              }}
            >
              <span className="palette-icon">{it.icon}</span>
              <span className="palette-label">{it.label}</span>
              {it.hint && <span className="palette-hint">{it.hint}</span>}
              {it.keys && <span className="palette-keys">{it.keys}</span>}
            </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
