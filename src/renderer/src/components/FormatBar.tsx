import { useFormatter, type Formatter } from '../lib/formatbus'

/**
 * The Word-style formatting bar. It writes the markdown for you on the focused
 * block; mousedown is swallowed so clicks never steal focus or selection from
 * the textarea it's about to act on.
 *
 * Pass `fmt` to bind it to one editor (a normal note renders its own). Omit it
 * and the bar follows the focused editor via formatbus — which is how the
 * journal shows ONE bar at the top of a page stacking an editor per day.
 */
export function FormatBar({ fmt: bound }: { fmt?: Formatter | null }): React.JSX.Element {
  const live = useFormatter()
  const fmt = bound !== undefined ? bound : live
  const block = fmt?.block ?? null
  // Code and table blocks have no inline markdown to apply.
  const canFmt = !!fmt && block !== null && block.type !== 'code' && block.type !== 'table'
  const apply = (open: string, close?: string) => (): void => fmt?.applyInline(open, close)
  const kind =
    (k: 1 | 2 | 3 | 'bullet' | 'ordered' | 'task' | 'quote') =>
    (): void =>
      fmt?.setBlockKind(k)

  return (
    <div
      className="fmt-bar"
      title={canFmt ? undefined : 'Click into a line of text to enable formatting'}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className="fmt-btn fmt-bold" title="Bold (⌘B)" disabled={!canFmt} onClick={apply('**')}>
        B
      </button>
      <button className="fmt-btn fmt-italic" title="Italic (⌘I)" disabled={!canFmt} onClick={apply('_')}>
        I
      </button>
      <button className="fmt-btn fmt-strike" title="Strikethrough" disabled={!canFmt} onClick={apply('~~')}>
        S
      </button>
      <button className="fmt-btn fmt-hl" title="Highlight" disabled={!canFmt} onClick={apply('==')}>
        A
      </button>
      <button className="fmt-btn fmt-mono" title="Inline code (⌘E)" disabled={!canFmt} onClick={apply('`')}>
        {'</>'}
      </button>
      <button className="fmt-btn fmt-mono" title="Wikilink" disabled={!canFmt} onClick={apply('[[', ']]')}>
        {'[[ ]]'}
      </button>
      <span className="fmt-sep" />
      {([1, 2, 3] as const).map((n) => (
        <button
          key={n}
          className={'fmt-btn' + (block?.type === 'heading' && block.level === n ? ' on' : '')}
          title={`Heading ${n}`}
          disabled={!canFmt}
          onClick={kind(n)}
        >
          H{n}
        </button>
      ))}
      <span className="fmt-sep" />
      <button
        className={'fmt-btn' + (block?.type === 'bullet' && !block.ordered ? ' on' : '')}
        title="Bulleted list"
        disabled={!canFmt}
        onClick={kind('bullet')}
      >
        •
      </button>
      <button
        className={'fmt-btn' + (block?.type === 'bullet' && block.ordered ? ' on' : '')}
        title="Numbered list"
        disabled={!canFmt}
        onClick={kind('ordered')}
      >
        1.
      </button>
      <button
        className={'fmt-btn' + (block?.type === 'task' ? ' on' : '')}
        title="To-do (⌘↩)"
        disabled={!canFmt}
        onClick={kind('task')}
      >
        ☐
      </button>
      <button
        className={'fmt-btn' + (block?.type === 'quote' ? ' on' : '')}
        title="Quote"
        disabled={!canFmt}
        onClick={kind('quote')}
      >
        ❝
      </button>
    </div>
  )
}
