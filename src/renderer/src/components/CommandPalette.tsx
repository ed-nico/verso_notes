import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, templatesFromFiles } from '../store'
import { dirname } from '../lib/links'
import { fuzzyScore, searchNotes } from '../lib/search'

interface Item {
  id: string
  label: string
  hint?: string
  icon: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  const setPalette = useStore((s) => s.setPalette)
  const files = useStore((s) => s.files)
  const texts = useStore((s) => s.texts)
  const history = useStore((s) => s.history)
  const activePath = useStore((s) => s.activePath)
  const templates = useMemo(() => templatesFromFiles(files), [files])
  const openNote = useStore((s) => s.openNote)
  const navigate = useStore((s) => s.navigate)
  const openView = useStore((s) => s.openView)
  const openTag = useStore((s) => s.openTag)
  const openModal = useStore((s) => s.openModal)
  const toggleTheme = useStore((s) => s.toggleTheme)
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

  const commands: Item[] = useMemo(
    () => [
      { id: 'new', label: 'New note', icon: '＋', run: () => act(() => void navigate(uniqueUntitled())) },
      ...templates.map((t) => ({
        id: `tmpl:${t.path}`,
        label: `New from template: ${t.name}`,
        icon: '▤',
        run: () => act(() => void newFromTemplate(t.path))
      })),
      { id: 'journal', label: 'Open Journal', icon: '☼', run: () => act(() => openView('journal')) },
      { id: 'todos', label: 'Open Todos', icon: '✓', run: () => act(() => openView('todos')) },
      { id: 'graph', label: 'Open Graph', icon: '⦿', run: () => act(() => openView('graph')) },
      { id: 'bases', label: 'Open Bases', icon: '▦', run: () => act(() => openView('database')) },
      { id: 'tags', label: 'Open Tags', icon: '#', run: () => act(() => openTag(null)) },
      { id: 'assets', label: 'Open Assets', icon: '⧉', run: () => act(() => openView('assets')) },
      { id: 'reload', label: 'Reload / re-scan vault folder', icon: '⟳', run: () => act(() => void reloadVault()) },
      ...(activePath
        ? [
            {
              id: 'export-pdf',
              label: 'Export note as PDF…',
              icon: '⤓',
              run: () =>
                act(() =>
                  void useStore
                    .getState()
                    .saveActive()
                    .then(() => window.verso.exportPdf(activePath.replace(/\.md$/i, '').split('/').pop() ?? 'note'))
                )
            }
          ]
        : []),
      { id: 'theme', label: 'Toggle light / dark theme', icon: '☾', run: () => act(() => toggleTheme()) },
      { id: 'settings', label: 'Open Settings', icon: '⚙', run: () => act(() => openModal('settings')) },
      { id: 'help', label: 'Open Help & shortcuts', icon: '?', run: () => act(() => openModal('help')) }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, files, activePath]
  )

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
      out.push({ id: `recent:${p}`, label: f.name, hint: dirname(p), icon: '◷', run: () => act(() => openNote(p)) })
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
    const noteHits: Item[] = searchNotes(q, files, texts, 12, {
      aliasOf: (p) => useStore.getState().parsed[p]?.aliases ?? [],
      parsed: useStore.getState().parsed
    }).map((h) => ({
      id: `note:${h.path}`,
      label: h.name,
      hint: h.snippet || h.path,
      icon: '▢',
      run: () => act(() => openNote(h.path))
    }))
    const create: Item[] = files.some((f) => f.name.toLowerCase() === q.toLowerCase())
      ? []
      : [{ id: 'create', label: `Create note “${q}”`, icon: '＋', run: () => act(() => void navigate(q)) }]
    return [...cmdHits, ...noteHits, ...create]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commands, recent, files, texts])

  useEffect(() => {
    if (sel >= items.length) setSel(Math.max(0, items.length - 1))
  }, [items.length, sel])

  if (!open) return null

  // True when the selection last moved by keyboard — only then do we auto-scroll
  // (scrolling on hover-driven selection would fight the user's mouse wheel).
  const kbdNav = useRef(false)
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
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
