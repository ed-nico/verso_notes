/**
 * Linked and unlinked references under a note.
 *
 * Mobile had none of this: the vault index was built for search only, and the
 * note screen ended at the last block. But a phone is where you READ, and
 * references are how a vault reads — the backlinks are half of what a note means.
 *
 * Everything here comes from the shared VaultIndex, so the rules (what resolves,
 * what counts as an unlinked mention) are the desktop's rules, not a second
 * approximation of them.
 */
import { useMemo, useState } from 'react'
import type { Backlink } from '@vlib/vault'
import { useApp, vaultIndex } from './state'
import { renderInline } from './inline'

/**
 * Groups above which a section opens COLLAPSED — the desktop's threshold, and
 * for the same reason: a note that is nothing but frontmatter can still be
 * mentioned by dozens of others, and expanded they bury the note they belong to.
 * A phone screen holds far less than a desktop one, so if anything this is late.
 */
const AUTO_COLLAPSE_GROUPS = 10

function group(links: Backlink[]): [string, Backlink[]][] {
  const by = new Map<string, Backlink[]>()
  for (const bl of links) by.set(bl.sourcePath, [...(by.get(bl.sourcePath) ?? []), bl])
  return [...by.entries()].sort((a, b) => a[1][0].sourceName.localeCompare(b[1][0].sourceName))
}

function Section({
  title,
  groups,
  onOpen,
  startOpen
}: {
  title: string
  groups: [string, Backlink[]][]
  onOpen: (p: string) => void
  startOpen: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(startOpen)
  const heavy = groups.length > AUTO_COLLAPSE_GROUPS
  // Derived default plus explicit overrides, as on the desktop: seeding a
  // collapsed set instead would paint the list at full height for one frame.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map())
  const isOpen = (p: string): boolean => overrides.get(p) ?? !heavy
  const anyOpen = groups.some(([p]) => isOpen(p))
  if (groups.length === 0) return null

  return (
    <div className="refs-section">
      <button className="refs-head" onClick={() => setOpen((v) => !v)}>
        <span className="refs-caret">{open ? '▾' : '▸'}</span>
        {groups.length} {title}
        {groups.length === 1 ? '' : 's'}
      </button>
      {open && groups.length > 1 && (
        <button
          className="refs-all"
          onClick={() =>
            setOverrides(() => {
              const next = new Map<string, boolean>()
              for (const [p] of groups) next.set(p, !anyOpen)
              return next
            })
          }
        >
          {anyOpen ? '⌃ Collapse all' : '⌄ Expand all'}
        </button>
      )}
      {open &&
        groups.map(([path, links]) => (
          <div className="refs-group" key={path}>
            <div className="refs-source">
              <span
                className="refs-caret"
                onClick={() => setOverrides((m) => new Map(m).set(path, !isOpen(path)))}
              >
                {isOpen(path) ? '▾' : '▸'}
              </span>
              <button className="refs-name" onClick={() => onOpen(path)}>
                {links[0].sourceName}
              </button>
              <span className="refs-count">{links.length}</span>
            </div>
            {isOpen(path) &&
              links.map((bl, i) => (
                <div className="refs-context" key={i}>
                  {renderInline(bl.context, { onWikilink: () => onOpen(path), onUrl: () => undefined })}
                </div>
              ))}
          </div>
        ))}
    </div>
  )
}

export function References({ path }: { path: string }): React.JSX.Element | null {
  const parsed = useApp((s) => s.parsed)
  const texts = useApp((s) => s.texts)
  const openNote = useApp((s) => s.openNote)
  const [wantUnlinked, setWantUnlinked] = useState(false)

  const linked = useMemo(() => group(vaultIndex(parsed, texts).backlinksFor(path)), [parsed, texts, path])
  // The unlinked scan reads every note in the vault. On a phone that is the one
  // genuinely expensive thing here, so it waits to be asked for.
  const unlinked = useMemo(
    () => (wantUnlinked ? group(vaultIndex(parsed, texts).unlinkedReferences(path)) : []),
    [parsed, texts, path, wantUnlinked]
  )

  return (
    <div className="refs">
      <Section title="linked reference" groups={linked} onOpen={openNote} startOpen />
      {linked.length === 0 && <div className="refs-empty">Nothing links here yet.</div>}
      {!wantUnlinked ? (
        <button className="refs-head" onClick={() => setWantUnlinked(true)}>
          <span className="refs-caret">▸</span>Unlinked references
        </button>
      ) : (
        <>
          <Section title="unlinked reference" groups={unlinked} onOpen={openNote} startOpen />
          {unlinked.length === 0 && <div className="refs-empty">No unlinked mentions.</div>}
        </>
      )}
    </div>
  )
}
