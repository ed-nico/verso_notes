import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Backlink } from '../lib/vault'
import { resolveTarget } from '../lib/links'
import { renderInline } from './InlineMarkdown'

type SortMode = 'name' | 'name-desc' | 'modified'

interface InlineOpts {
  isResolved: (raw: string) => boolean
  onNavigate: (raw: string, newTab?: boolean) => void
  onTag?: (tag: string) => void
}

/** Context line rendered with full inline Markdown (links, bold, code, tags…). */
function ContextText({ text, name, opts }: { text: string; name: string; opts: InlineOpts }): React.JSX.Element {
  // Drop any leftover `^id` anchors so they never appear on screen.
  const cleaned = text.replace(/\s\^[A-Za-z0-9-]+(?=\s|$)/g, '')
  if (cleaned.trim() === '') return <em>links to {name}</em>
  const lines = cleaned.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 1) return <>{renderInline(stripMarker(cleaned).text, opts)}</>
  // Block context (list item + children / paragraph / heading section): one row
  // per line, keeping relative indentation and bullets for orientation.
  const base = Math.min(...lines.map((l) => l.match(/^\s*/)![0].length))
  return (
    <>
      {lines.map((l, i) => {
        const { text: t, listItem } = stripMarker(l)
        const depth = Math.max(0, Math.round((l.match(/^\s*/)![0].length - base) / 2))
        return (
          <span key={i} className="bl-ctx-line" style={{ paddingLeft: depth * 12 }}>
            {listItem && <span className="bl-ctx-dot">•</span>}
            {renderInline(t, opts)}
          </span>
        )
      })}
    </>
  )
}

/** Strip a leading list/task marker; report whether the line was a list item. */
function stripMarker(line: string): { text: string; listItem: boolean } {
  const t = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
  return { text: t.trim(), listItem: t !== line }
}

/** A single backlink reference. Unlinked ones get a "Link" action to wrap the mention. */
function Reference({ bl, opts, onLink }: { bl: Backlink; opts: InlineOpts; onLink?: () => void }): React.JSX.Element {
  return (
    <div className="backlink-ctx">
      <span className="backlink-text">
        <ContextText text={bl.context} name={bl.sourceName} opts={opts} />
      </span>
      {onLink && (
        <button className="bl-link-btn" title="Turn this mention into a [[link]]" onClick={onLink}>
          ↩ Link
        </button>
      )}
    </div>
  )
}

/** A collapsible section header with a count. */
function SectionHead({
  open,
  count,
  label,
  onToggle
}: {
  open: boolean
  count: number
  label: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <h3 className="bl-section-head" onClick={onToggle}>
      <span className="bl-caret">{open ? '▾' : '▸'}</span>
      {count} {label}
      {count === 1 ? '' : 's'}
    </h3>
  )
}

/**
 * Reference groups above which a section opens COLLAPSED.
 *
 * Measured against the real vault: the median note with any backlink has 2
 * groups, p90 is 3 and p95 is 5 — so 10 leaves the ordinary note untouched and
 * catches only the ~1% that bury themselves. It sits just under p98 (11), which
 * is deliberate: a person note with no body of its own and eleven notes
 * mentioning it is exactly the case that prompted this.
 */
const AUTO_COLLAPSE_GROUPS = 10

export function Backlinks({ path }: { path: string }): React.JSX.Element {
  const index = useStore((s) => s.index)
  const files = useStore((s) => s.files)
  const openNote = useStore((s) => s.openNote)
  const navigate = useStore((s) => s.navigate)
  const openTag = useStore((s) => s.openTag)
  const linkUnlinked = useStore((s) => s.linkUnlinked)
  const linkAllUnlinked = useStore((s) => s.linkAllUnlinked)
  const [sort, setSort] = useState<SortMode>('name')
  const [filter, setFilter] = useState('')
  const [showLinked, setShowLinked] = useState(true)
  const [showUnlinked, setShowUnlinked] = useState(false)
  // Groups the reader has explicitly opened or shut. Everything else follows the
  // section's default, which is DERIVED (see AUTO_COLLAPSE_GROUPS) rather than
  // stored — so a heavy note paints collapsed on the first frame instead of
  // flashing its full height and then folding up.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map())
  // A different note is a different question; its predecessor's choices mean nothing.
  const shownFor = useRef(path)
  if (shownFor.current !== path) {
    shownFor.current = path
    if (overrides.size) setOverrides(new Map())
  }
  const isOpen = (p: string, heavy: boolean): boolean => overrides.get(p) ?? !heavy
  const toggleGroup = (p: string, heavy: boolean): void =>
    setOverrides((prev) => new Map(prev).set(p, !isOpen(p, heavy)))

  const allPaths = useMemo(() => files.map((f) => f.path), [files])
  const inlineOpts: InlineOpts = {
    isResolved: (raw) => (resolveTarget(raw, allPaths) ?? index.resolvePath(raw)) !== null,
    onNavigate: navigate,
    onTag: openTag
  }

  // Group a flat backlink list by source note, then filter + sort.
  const groupAndSort = useMemo(() => {
    const mtimeOf = (p: string): number => files.find((f) => f.path === p)?.mtime ?? 0
    const q = filter.toLowerCase().trim()
    return (links: Backlink[]): [string, Backlink[]][] => {
      const bySource = new Map<string, Backlink[]>()
      for (const bl of links) {
        const list = bySource.get(bl.sourcePath) ?? []
        list.push(bl)
        bySource.set(bl.sourcePath, list)
      }
      let entries = [...bySource.entries()]
      if (q)
        entries = entries.filter(
          ([, l]) => l[0].sourceName.toLowerCase().includes(q) || l.some((x) => x.context.toLowerCase().includes(q))
        )
      entries.sort((a, b) => {
        if (sort === 'modified') return mtimeOf(b[0]) - mtimeOf(a[0])
        const cmp = a[1][0].sourceName.localeCompare(b[1][0].sourceName)
        return sort === 'name-desc' ? -cmp : cmp
      })
      return entries
    }
  }, [files, sort, filter])

  const linked = useMemo(() => groupAndSort(index.backlinksFor(path)), [groupAndSort, index, path])
  // Unlinked references scan every note in the vault, so only compute them when the
  // section is actually opened (null = not yet computed). This keeps note-switching fast.
  const unlinkedAll = useMemo(
    () => (showUnlinked ? index.unlinkedReferences(path) : null),
    [index, path, showUnlinked]
  )
  const unlinked = useMemo(
    () => (unlinkedAll ? groupAndSort(unlinkedAll) : []),
    [groupAndSort, unlinkedAll]
  )

  // Each section decides its own default independently, so opening the unlinked
  // list can never fold up the linked groups you were reading.
  const linkedHeavy = linked.length > AUTO_COLLAPSE_GROUPS
  const unlinkedHeavy = unlinked.length > AUTO_COLLAPSE_GROUPS

  // Collapse/expand every group at once. A note with no body of its own can still
  // carry a hundred references, each expanded to a context line — the section then
  // buries the note it belongs to, and closing them one at a time is no help.
  // Only what is actually on screen: `unlinked` is already empty while its section
  // is shut, and the linked list survives its own section being closed, so the
  // button would otherwise report on groups nobody can see.
  const visibleGroups = useMemo(
    () =>
      [
        ...(showLinked ? linked : []).map(([p]) => [p, linkedHeavy] as const),
        ...unlinked.map(([p]) => [p, unlinkedHeavy] as const)
      ],
    [linked, unlinked, showLinked, linkedHeavy, unlinkedHeavy]
  )
  const anyOpen = visibleGroups.some(([p, heavy]) => isOpen(p, heavy))
  // Writes an explicit override for every group on screen. Groups hidden by the
  // filter (or in a shut section) aren't touched, so they keep whatever they had
  // rather than being silently reopened.
  const toggleAll = (): void =>
    setOverrides((prev) => {
      const next = new Map(prev)
      for (const [p] of visibleGroups) next.set(p, !anyOpen)
      return next
    })

  const renderGroups = (
    groups: [string, Backlink[]][],
    linkable = false,
    heavy = false
  ): React.ReactNode =>
    groups.map(([sourcePath, links]) => {
      const open = isOpen(sourcePath, heavy)
      return (
        <div className="backlink-group" key={sourcePath}>
          <div className="backlink-source-row">
            <span className="bl-group-caret" onClick={() => toggleGroup(sourcePath, heavy)}>
              {open ? '▾' : '▸'}
            </span>
            <span
              className="backlink-source"
              role="link"
              tabIndex={0}
              onClick={() => openNote(sourcePath)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  openNote(sourcePath)
                }
              }}
            >
              {links[0].sourceName}
            </span>
            <span className="bl-group-count">{links.length}</span>
          </div>
          {open &&
            links.map((bl, i) => (
              <Reference
                key={i}
                bl={bl}
                opts={inlineOpts}
                onLink={linkable ? () => void linkUnlinked(bl.sourcePath, bl.line, bl.ref.raw) : undefined}
              />
            ))}
        </div>
      )
    })

  return (
    <div className="backlinks">
      <div className="backlinks-head">
        <h3 className="bl-title">{linked.length === 0 ? 'No linked references' : 'References'}</h3>
        <div className="bl-controls">
          <input className="bl-filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select className="bl-sort" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="name">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="modified">Recently modified</option>
          </select>
          {visibleGroups.length > 1 && (
            <button
              className="bl-toggle-all"
              onClick={toggleAll}
              title={anyOpen ? 'Collapse every reference group' : 'Expand every reference group'}
            >
              {anyOpen ? '⌃ Collapse all' : '⌄ Expand all'}
            </button>
          )}
        </div>
      </div>

      {/* A bare "No linked references" heading is a dead end: it states a fact and
          leaves you without the one move that changes it. */}
      {linked.length === 0 && (
        <p className="bl-empty">
          Nothing links here yet. Type <code>[[</code> in another note and pick this one — or check the unlinked
          references below, which are notes that mention its name without linking.
        </p>
      )}

      {linked.length > 0 && (
        <div className="bl-section">
          <SectionHead open={showLinked} count={linked.length} label="linked reference" onToggle={() => setShowLinked((v) => !v)} />
          {showLinked && renderGroups(linked, false, linkedHeavy)}
        </div>
      )}

      {/* Always shown so it's expandable; the vault-wide scan only runs once opened. */}
      <div className="bl-section">
        <h3 className="bl-section-head" onClick={() => setShowUnlinked((v) => !v)}>
          <span className="bl-caret">{showUnlinked ? '▾' : '▸'}</span>
          {unlinkedAll === null
            ? 'Unlinked references'
            : `${unlinkedAll.length} unlinked reference${unlinkedAll.length === 1 ? '' : 's'}`}
        </h3>
        {showUnlinked && unlinkedAll && unlinkedAll.length > 0 && (
          <>
            <button className="bl-linkall" onClick={() => void linkAllUnlinked(path)} title="Turn every mention into a [[link]]">
              ↩ Link all
            </button>
            {renderGroups(unlinked, true, unlinkedHeavy)}
          </>
        )}
      </div>
    </div>
  )
}
