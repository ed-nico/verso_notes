/** Rendered read-view of blocks — shared by the note screen and the journal feed. */
import { createContext, useContext, useMemo } from 'react'
import { parseBlocks, parseTable, isList, type Block } from '@vlib/blocks'
import { FILE_LINK_RE } from '@shared/media'
import { resolveTarget } from '@vlib/links'
import { useApp, vaultIndex } from './state'
import { baseRows } from './baserows'
import { renderInline } from './inline'

/** A block that is nothing but `![[Some Note]]`. */
const EMBED_RE = /^!\[\[([^\]\n]+?)\]\]$/
/** `{{query …}}` / `{{base …}}` alone on a line, same as the desktop's. */
const QUERY_RE = /^\{\{query\s+([^}]+)\}\}$/i
const BASE_RE = /^\{\{base\s+([^}]+)\}\}$/i

/** Notes already being rendered above this point, so `![[Self]]` — directly or
 *  through a chain — can't recurse. Seeded with the host note by NoteScreen. */
const EmbedChain = createContext<readonly string[]>([])
export const EmbedHost = EmbedChain.Provider

/**
 * `![[Note]]` on its own line renders that note inside this one, read-only.
 * Note-level only — block references stay removed, same as on the desktop.
 */
function NoteEmbed({ raw, onWikilink }: { raw: string; onWikilink: (t: string) => void }): React.JSX.Element {
  const files = useApp((s) => s.files)
  const texts = useApp((s) => s.texts)
  const openNote = useApp((s) => s.openNote)
  const chain = useContext(EmbedChain)
  const path = resolveTarget(raw, files.map((f) => f.path))

  if (!path) return <div className="embed missing">{raw} — no note with this name yet.</div>
  if (chain.includes(path))
    return <div className="embed missing">{raw} — already shown above; an embed can’t contain itself.</div>

  const text = texts[path]
  const name = path.replace(/\.md$/i, '').split('/').pop()
  return (
    <EmbedChain.Provider value={[...chain, path]}>
      <div className="embed">
        <button className="embed-title" onClick={() => void openNote(path)}>
          {name}
        </button>
        {text === undefined ? (
          <div className="embed-note">Not read yet — pull to refresh.</div>
        ) : text.trim() === '' ? (
          <div className="embed-note">This note is empty.</div>
        ) : (
          parseBlocks(text).blocks.map((eb) => (
            <BlockView key={eb.id} b={eb} onWikilink={onWikilink} onToggleTask={() => undefined} />
          ))
        )}
      </div>
    </EmbedChain.Provider>
  )
}

/**
 * Live results for a `{{query …}}` block.
 *
 * These used to render as the literal text `{{query #film scope:notes}}`, which
 * on a phone reads as a broken note rather than a feature that isn't there. The
 * whole query language comes from the shared lib, so this is only a list.
 *
 * The chain's first entry is the HOST note — what `follow:` walks out from, so
 * "my children" resolves against the note you're actually reading.
 */
function QueryBlock({ raw }: { raw: string }): React.JSX.Element {
  const parsed = useApp((s) => s.parsed)
  const texts = useApp((s) => s.texts)
  const openNote = useApp((s) => s.openNote)
  const chain = useContext(EmbedChain)
  const host = chain[0]

  const result = useMemo(() => {
    // A sidebar row is a note, and so is a phone row: default to note scope
    // unless the query names one, exactly as the desktop's search box does.
    const q = /(^|\s)scope:/i.test(raw) ? raw : `${raw} scope:notes`
    return vaultIndex(parsed, texts).runQuery(q, host)
  }, [parsed, texts, raw, host])

  const rows = result.notes ?? []
  const blocks = result.blocks ?? []
  const shown = rows.length || blocks.length
  return (
    <div className="qblock">
      <div className="qblock-head">
        <span className="qblock-q">{raw}</span>
        <span className="qblock-count">{shown < result.total ? `${shown} of ${result.total}` : shown}</span>
      </div>
      {shown === 0 && <div className="qblock-empty">Nothing matches.</div>}
      {rows.map((n) => (
        <button className="qblock-row" key={n.path} onClick={() => void openNote(n.path)}>
          <span className="qblock-name">{n.name}</span>
          {n.excerpt && <span className="qblock-excerpt">{n.excerpt}</span>}
        </button>
      ))}
      {blocks.map((b, i) => (
        <button className="qblock-row" key={i} onClick={() => void openNote(b.path)}>
          <span className="qblock-name">{b.text}</span>
          <span className="qblock-excerpt">{b.name}</span>
        </button>
      ))}
    </div>
  )
}

/** A `{{base Name}}` embed — the saved view's notes, read-only. */
function BaseBlock({ raw }: { raw: string }): React.JSX.Element {
  const bases = useApp((s) => s.bases)
  const parsed = useApp((s) => s.parsed)
  const openNote = useApp((s) => s.openNote)
  const name = raw.split(/\s+/)[0]
  const base = bases.find((b) => b.name.toLowerCase() === name.toLowerCase())
  const rows = useMemo(() => (base ? baseRows(base, parsed) : []), [base, parsed])
  if (!base) return <div className="embed missing">{raw} — no base with this name.</div>
  return (
    <div className="qblock">
      <div className="qblock-head">
        <span className="qblock-q">▤ {base.name}</span>
        <span className="qblock-count">{rows.length}</span>
      </div>
      {rows.slice(0, 50).map((n) => (
        <button className="qblock-row" key={n.path} onClick={() => void openNote(n.path)}>
          <span className="qblock-name">{n.name}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * A line down each ancestor level, as one background-IMAGE gradient per row —
 * so a deep outline costs no extra DOM. Never the `background` shorthand: the
 * row's own background-colour comes from CSS and the shorthand would clear it.
 * The row is already indented by margin, so the guides are drawn in that margin.
 */
function guideStyle(level: number): React.CSSProperties {
  if (level < 1) return {}
  const stops: string[] = []
  const pos: string[] = []
  for (let i = 0; i < level; i++) {
    stops.push('linear-gradient(var(--guide), var(--guide))')
    pos.push(`${-(level - i) * 18 + 7}px 0`)
  }
  return {
    backgroundImage: stops.join(','),
    backgroundPosition: pos.join(','),
    backgroundSize: `1px 100%`,
    backgroundRepeat: 'no-repeat'
  }
}

export interface BlockViewProps {
  b: Block
  onWikilink: (t: string) => void
  onToggleTask: (id: number) => void
}

export function BlockView({ b, onWikilink, onToggleTask }: BlockViewProps): React.JSX.Element {
  const opts = { onWikilink, onUrl: (u: string) => window.open(u, '_blank') }
  if (b.type !== 'code' && b.type !== 'table') {
    const m = b.text.trim().match(EMBED_RE)
    const target = m?.[1].split('|')[0].trim()
    // An `![[file.png]]` is an ASSET embed and keeps the inline renderer's chip.
    if (target && !FILE_LINK_RE.test(target)) return <NoteEmbed raw={target} onWikilink={onWikilink} />
    const q = b.text.trim().match(QUERY_RE)
    if (q) return <QueryBlock raw={q[1].trim()} />
    const bs = b.text.trim().match(BASE_RE)
    if (bs) return <BaseBlock raw={bs[1].trim()} />
  }
  if (b.type === 'code')
    return (
      <pre className="code">
        <code>{b.text}</code>
      </pre>
    )
  if (b.type === 'table') {
    const { header, rows } = parseTable(b.text)
    return (
      <div className="md-table-scroll">
        <table className="md-table">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i}>{renderInline(h, opts)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{renderInline(c, opts)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (b.type === 'heading') {
    const H = `h${Math.min(b.level || 1, 4)}` as 'h1' | 'h2' | 'h3' | 'h4'
    return <H>{renderInline(b.text, opts)}</H>
  }
  if (b.type === 'task')
    return (
      <div className="li task" style={{ marginLeft: b.level * 18 }}>
        <input type="checkbox" checked={!!b.checked} onChange={() => onToggleTask(b.id)} />
        <span className={b.checked ? 'done' : ''}>{renderInline(b.text, opts)}</span>
      </div>
    )
  if (isList(b))
    return (
      <div className="li" style={{ marginLeft: b.level * 18, ...guideStyle(b.level) }}>
        <span className="dot">{b.ordered ? `${b.ordinal ?? 1}.` : '•'}</span>
        <span>{renderInline(b.text, opts)}</span>
      </div>
    )
  if (b.text === '---') return <hr />
  return <p>{renderInline(b.text, opts)}</p>
}
