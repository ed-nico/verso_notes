import { createElement, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { compileNote, joinSections } from '../lib/compile'
import { basename, dirname } from '../lib/links'
import { noteStats } from '../lib/stats'
import { renderInline } from './InlineMarkdown'

/** Lightweight read-only markdown rendering for the compiled document. */
function MdPreview({ md, opts }: { md: string; opts: Parameters<typeof renderInline>[1] }): React.JSX.Element {
  const lines = md.split('\n')
  let inFence = false
  return (
    <div className="compile-doc">
      {lines.map((l, i) => {
        if (/^\s{0,3}(?:`{3,}|~{3,})/.test(l)) {
          inFence = !inFence
          return (
            <div key={i} className="compile-code">
              {l}
            </div>
          )
        }
        if (inFence)
          return (
            <div key={i} className="compile-code">
              {l || ' '}
            </div>
          )
        const h = l.match(/^(#{1,6})\s+(.*)/)
        if (h) return createElement(`h${h[1].length}`, { key: i }, renderInline(h[2], opts))
        if (/^\s*(?:---+|\*\*\*+)\s*$/.test(l)) return <hr key={i} />
        const li = l.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)/)
        if (li)
          return (
            <div key={i} className="compile-li" style={{ paddingLeft: (li[1].length / 2) * 14 }}>
              <span className="compile-dot">•</span>
              {renderInline(li[2], opts)}
            </div>
          )
        if (!l.trim()) return <div key={i} className="compile-blank" />
        return <p key={i}>{renderInline(l, opts)}</p>
      })}
    </div>
  )
}

/** Compile mode: assemble the hub note + the notes it links (recursively) into
 *  one linear document — preview it, copy it, or save it back as a note. */
export function CompileView({ path, onClose }: { path: string; onClose: () => void }): React.JSX.Element {
  const files = useStore((s) => s.files)
  const textsTick = useStore((s) => s.textsTick)
  const index = useStore((s) => s.index)
  const navigate = useStore((s) => s.navigate)

  const [depth, setDepth] = useState(2)
  const [flatten, setFlatten] = useState(false)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sections = useMemo(() => {
    const { texts, parsed } = useStore.getState()
    return compileNote(path, texts, parsed, (raw) => index.resolvePath(raw), {
      maxDepth: depth,
      flattenLinks: flatten
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, depth, flatten, index, textsTick])

  const markdown = useMemo(() => joinSections(sections, excluded), [sections, excluded])
  const stats = useMemo(() => noteStats(markdown), [markdown])

  const inlineOpts: Parameters<typeof renderInline>[1] = {
    isResolved: (raw) => index.resolvePath(raw) !== null,
    onNavigate: (raw, newTab) => {
      onClose()
      void navigate(raw, newTab)
    },
    noPreview: true
  }

  const toggle = (p: string): void =>
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const saveAsNote = async (): Promise<void> => {
    const s = useStore.getState()
    const dir = dirname(path)
    const base = `${basename(path)} (compiled)`
    const taken = new Set(s.files.map((f) => f.path.toLowerCase()))
    const prefix = dir ? `${dir}/` : ''
    let np = `${prefix}${base}.md`
    let i = 2
    while (taken.has(np.toLowerCase())) np = `${prefix}${base} ${i++}.md`
    const created = await window.verso.createNote(np, markdown)
    if (created) {
      await s.applyFileEvent({ type: 'add', file: created })
      s.openNote(created.path)
      onClose()
    }
  }

  const hubName = files.find((f) => f.path === path)?.name ?? basename(path)

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal compile-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Compile — {hubName}</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="compile-body">
          <div className="compile-rail">
            <div className="compile-controls">
              <label className="compile-ctl">
                Depth
                <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((d) => (
                    <option key={d} value={d}>
                      {d} hop{d === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="compile-ctl" title="Replace [[wikilinks]] with plain text, for sharing outside the vault">
                <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
                Flatten links
              </label>
            </div>
            <div className="compile-sections">
              {sections.map((s) => (
                <label key={s.path} className="compile-section" style={{ paddingLeft: 8 + s.depth * 14 }}>
                  <input
                    type="checkbox"
                    disabled={s.depth === 0}
                    checked={!excluded.has(s.path)}
                    onChange={() => toggle(s.path)}
                  />
                  <span className="compile-section-name">{s.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="compile-preview">
            <MdPreview md={markdown} opts={inlineOpts} />
          </div>
        </div>
        <div className="compile-foot">
          <span className="compile-stats">
            {sections.length - excluded.size} notes · {stats.words.toLocaleString()} words · {stats.minutes} min read
          </span>
          <button className="btn ghost" onClick={() => void copy()}>
            {copied ? 'Copied ✓' : 'Copy Markdown'}
          </button>
          <button className="btn" onClick={() => void saveAsNote()}>
            Save as note
          </button>
        </div>
      </div>
    </div>
  )
}
