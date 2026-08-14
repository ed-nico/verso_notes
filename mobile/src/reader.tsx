/** Rendered read-view of blocks — shared by the note screen and the journal feed. */
import { createContext, useContext } from 'react'
import { parseBlocks, parseTable, isList, type Block } from '@vlib/blocks'
import { FILE_LINK_RE } from '@shared/media'
import { resolveTarget } from '@vlib/links'
import { useApp } from './state'
import { renderInline } from './inline'

/** A block that is nothing but `![[Some Note]]`. */
const EMBED_RE = /^!\[\[([^\]\n]+?)\]\]$/

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
      <div className="li" style={{ marginLeft: b.level * 18 }}>
        <span className="dot">{b.ordered ? `${b.ordinal ?? 1}.` : '•'}</span>
        <span>{renderInline(b.text, opts)}</span>
      </div>
    )
  if (b.text === '---') return <hr />
  return <p>{renderInline(b.text, opts)}</p>
}
