import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { dirname } from '../lib/links'
import { fuzzyScore } from '../lib/search'

/**
 * "Move to folder…" — pick a destination by typing.
 *
 * Dragging a note onto a folder in the sidebar was the only way to move one,
 * which stops scaling the moment the tree is taller than the panel: a real vault
 * has a couple of hundred folders and the target is usually collapsed and
 * off-screen, so the move turns into a scroll-while-holding-the-mouse-down.
 * Filtering by name is the same gesture as the command palette, and reuses its
 * markup wholesale.
 *
 * Folders are derived from the notes themselves — there is no folder list in the
 * store, and a folder with no notes in it isn't a move target worth offering.
 */
export function FolderPicker({
  path,
  name,
  placeholder,
  onPick,
  onClose
}: {
  /** The note being moved — also the folder excluded from the list. Pass '' when
   *  picking a folder for something other than a move. */
  path: string
  name: string
  placeholder?: string
  /** Given, this runs instead of moving the note — the picker is then just a
   *  filterable folder list (Tend's ignore list uses it that way). */
  onPick?: (folder: string) => void
  onClose: () => void
}): React.JSX.Element {
  const files = useStore((s) => s.files)
  const moveToFolder = useStore((s) => s.moveToFolder)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const here = dirname(path)

  const folders = useMemo(() => {
    // Every ancestor of every note, so nested folders are offered too — not just
    // the top level, which is all a note's own dirname would give you.
    const set = new Set<string>([''])
    for (const f of files) {
      const parts = f.path.split('/')
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
    }
    set.delete(here) // it's already there
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [files, here])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return folders.slice(0, 200)
    return folders
      .map((f) => ({ f, s: fuzzyScore(q, f || 'vault root') }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 200)
      .map((r) => r.f)
  }, [folders, query])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (folder: string): void => {
    onClose()
    if (onPick) onPick(folder)
    else void moveToFolder(path, folder)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[sel] !== undefined) {
      e.preventDefault()
      pick(results[sel])
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={placeholder ?? `Move “${name}” to…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No folder matches “{query}”</div>}
          {results.map((f, i) => (
            <div
              key={f || '/'}
              className={'palette-item' + (i === sel ? ' sel' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(f)}
            >
              <span className="palette-icon">{f === '' ? '⌂' : '▸'}</span>
              <span className="palette-label">{f === '' ? 'Vault root' : f.split('/').pop()}</span>
              {f.includes('/') && <span className="palette-hint">{dirname(f)}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
