import { parseBlocks, parseTable } from '../lib/blocks'
import { renderInline } from './InlineMarkdown'

export type InlineOpts = Parameters<typeof renderInline>[1]

/** A block that is nothing but `![[Some Note]]` — the same shape the editor treats
 *  as an embed. Kept here so the read-only renderer recognises exactly what the
 *  editor does. */
export const EMBED_BLOCK_RE = /^!\[\[([^\]\n]+?)\]\]$/

/**
 * Render a note's markdown as read-only formatted blocks.
 *
 * Shared by the ⌘-hover preview and by `![[Note]]` embeds. Pass `renderEmbed` to
 * render nested embeds (the embed component does; the hover preview deliberately
 * doesn't — a popup that grows more popups inside it is worse than a flat one).
 */
export function renderNote(
  text: string,
  opts: InlineOpts,
  renderEmbed?: (raw: string) => React.ReactNode
): React.ReactNode {
  return parseBlocks(text).blocks.map((b) => {
    if (renderEmbed && b.type !== 'code' && b.type !== 'table') {
      const m = b.text.trim().match(EMBED_BLOCK_RE)
      const target = m?.[1].split('|')[0].trim()
      if (target) return <div key={b.id}>{renderEmbed(target)}</div>
    }
    if (b.type === 'heading') {
      const lvl = Math.min(b.level || 1, 3)
      return (
        <div key={b.id} className={`hp-block tok-heading tok-h${lvl}`}>
          {renderInline(b.text, opts)}
        </div>
      )
    }
    if (b.type === 'code') {
      return (
        <pre key={b.id} className="hp-code">
          <code>{b.text}</code>
        </pre>
      )
    }
    if (b.type === 'table') {
      const { header, rows } = parseTable(b.text)
      return (
        <table key={b.id} className="hp-table">
          <thead>
            <tr>{header.map((h, i) => <th key={i}>{renderInline(h, opts)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, opts)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
    }
    const style = { paddingLeft: (b.level || 0) * 16 }
    if (b.type === 'task') {
      return (
        <div key={b.id} className={'hp-block hp-task' + (b.checked ? ' done' : '')} style={style}>
          <input type="checkbox" checked={!!b.checked} readOnly />
          <span>{renderInline(b.text, opts)}</span>
        </div>
      )
    }
    if (b.type === 'bullet') {
      return (
        <div key={b.id} className="hp-block hp-bullet" style={style}>
          <span className="hp-dot">•</span>
          <span>{renderInline(b.text, opts)}</span>
        </div>
      )
    }
    return (
      <div key={b.id} className="hp-block" style={style}>
        {b.text.trim() === '' ? ' ' : renderInline(b.text, opts)}
      </div>
    )
  })
}

