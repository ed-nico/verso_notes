import { useStore } from '../store'

/**
 * Editable page title shown at the top of a note. The title IS the note's
 * filename (without `.md`); committing a change renames the file via the store,
 * which rewrites every wikilink/backlink across the vault. Type a "/" to also
 * move the note into a folder.
 */
export function NoteTitle({ path }: { path: string }): React.JSX.Element {
  const name = useStore(
    (s) => s.files.find((f) => f.path === path)?.name ?? path.replace(/\.md$/i, '').split('/').pop() ?? ''
  )
  const renameNote = useStore((s) => s.renameNote)

  const commit = (value: string): void => {
    const v = value.trim()
    if (v && v !== name) void renameNote(path, v)
  }

  return (
    <input
      className="note-title"
      key={path}
      defaultValue={name}
      placeholder="Untitled"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.currentTarget.value = name
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => commit(e.target.value)}
    />
  )
}
