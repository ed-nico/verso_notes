import { useEffect, useMemo, useRef, useState } from 'react'

interface Row {
  /** Key combo or syntax (rendered as a chip). */
  k: string
  /** What it does. */
  d: string
}
interface Section {
  title: string
  /** One line on what this area is FOR — the reference rows assume you know. */
  note?: string
  rows: Row[]
}

/**
 * Help is a reference AND the app's only onboarding, so it opens with "Start
 * here" — the handful of moves that make the rest legible — before the
 * per-area detail. The filter box exists because the full list is ~120 rows:
 * without it, breadth reads as clutter rather than depth.
 */
const SECTIONS: Section[] = [
  {
    title: 'Start here',
    note: 'Six moves that explain the rest of the app.',
    rows: [
      { k: '⌘D', d: 'Today’s page. The daily note is the front door — capture first, file later. Works even mid-sentence.' },
      { k: '⌘K', d: 'Go anywhere: any note by name or full text, plus every command. If you learn one shortcut, learn this.' },
      { k: 'just write', d: 'There’s no Save. Every keystroke lands in a plain .md file on disk within a second.' },
      { k: '[[', d: 'Link to another note as you type — it doesn’t need to exist yet. Links are how the vault holds together.' },
      { k: '#tag', d: 'Tag anything. Later, a tag can grow fields and become a mini-database (Tags page → Schema).' },
      { k: '/', d: 'On an empty line, the slash menu lists everything you can insert: table, quote, callout, math, diagram, query, template.' }
    ]
  },
  {
    title: 'The main screens',
    note: 'Left sidebar. Everything else is a note.',
    rows: [
      { k: '☼ Journal', d: 'One page per day, newest first, scrolling back forever. Todos due that day surface here automatically.' },
      { k: '✓ Todos', d: 'Every - [ ] in the vault, rolled up as Overdue / Today / Upcoming. Tick it anywhere, it updates everywhere.' },
      { k: '# Tags', d: 'Every tag with counts. Give a tag fields and it becomes a typed tag with a table of instances.' },
      { k: '▤ Bases', d: 'Saved table/gallery views over your notes’ frontmatter — a spreadsheet layer on top of the same Markdown.' },
      { k: '◉ Graph', d: 'The whole vault as a force-directed map. Useful for spotting clusters and orphans, not for daily work.' },
      { k: '❧ Tend', d: 'The gardener’s report: suggested connections, orphans, stubs, stale notes, broken links.' }
    ]
  },
  {
    title: 'Find & navigate',
    rows: [
      { k: '⌘K  /  ⌘P', d: 'Command palette — jump to any note (filename or full-text), or run a command.' },
      { k: '⌘D', d: 'Open today’s daily note, creating it from your Journal template if it’s the first time today.' },
      { k: 'Search box', d: 'Searches note titles and body text; shows a matching snippet.' },
      { k: '⌘-click', d: 'Open a note or link in a split beside the current one. Repeat for several side by side.' },
      { k: '⌘[ / ⌘]', d: 'Back / forward through where you’ve been.' },
      { k: '⌘\\  ·  ⌘⇧\\', d: 'Show / hide the left sidebar · the right panel.' },
      { k: '⌘W', d: 'Close the last split.' },
      { k: 'drag a note', d: 'Reorder within a folder, or drop onto a folder to move it in.' }
    ]
  },
  {
    title: 'Links & backlinks',
    note: 'Links are one-directional to write and bi-directional to read.',
    rows: [
      { k: '[[Page]]', d: 'Link to a page. Type [[ to search and pick one — it needn’t exist yet.' },
      { k: '[[Page|alias]]', d: 'Link with custom display text.' },
      { k: 'backlinks', d: 'Every note lists what links to it at the bottom — plus unlinked mentions, where its name appears without a link.' },
      { k: '⌘-hover', d: 'Peek at a linked note without leaving this one.' },
      { k: 'paste a URL', d: 'Autolinks; on its own line it fetches the page title. YouTube/Vimeo/Loom embed a player.' },
      { k: '⌘;', d: 'While a video plays, stamp the play time into your note. Click it later to jump the video there.' },
      { k: 'rename a note', d: 'Every [[link]] to it is rewritten across the vault. Code blocks are left alone.' }
    ]
  },
  {
    title: 'Writing — type these at the start of a line',
    rows: [
      { k: '# ', d: 'Heading (## , ### for levels).' },
      { k: '- ', d: 'Bullet.  1. starts a numbered list.' },
      { k: '[] ', d: 'Task / checkbox. ⌘Enter cycles a line: text → ☐ → ☑ → text.' },
      { k: '> ', d: 'Blockquote.' },
      { k: '> [!tip] Title', d: 'A callout box. Kinds: note, abstract, info, tip, success, question, warning, failure, danger, bug, example, quote. Add - (> [!tip]- ) to start it collapsed.' },
      { k: '```', d: 'Code block. Tag it ```mermaid for a diagram, or ```ts etc. for syntax highlighting.' },
      { k: '---', d: 'Horizontal rule.' },
      { k: '/', d: 'Slash menu on an empty line: template, headings, todo, bullet, table, quote, callout, math, Mermaid, query, base.' }
    ]
  },
  {
    title: 'Writing — inline',
    rows: [
      { k: '**bold**  _italic_', d: '⌘B / ⌘I wrap the selection. Also `code` (⌘E), ~~strike~~, ==highlight==.' },
      { k: '$E = mc^2$', d: 'Inline LaTeX. Use $$ … $$ on its own line for display math. Prices are safe — “it costs $5 and $10” stays prose.' },
      { k: '![400](url)', d: 'Image — the number is the max width in px. Drag the handle to resize.' },
      { k: 'paste an image', d: 'Saved into assets/ and shown inline. Same for a dropped file.' },
      { k: '#tag', d: 'Tags work anywhere in a line, and nest: #project/alpha.' }
    ]
  },
  {
    title: 'Todos & due dates',
    rows: [
      { k: '- [ ] task', d: 'Any line starting with - [ ] is an open todo (- [x] is done). The Todos page collects them from every note.' },
      { k: '@2026-06-20', d: 'A due date inline. Grouped on the Todos page as Overdue / Today / Upcoming.' },
      { k: 'in a daily note', d: 'A todo with no due date is scheduled for that day — write it in today’s page and it’s today’s task.' },
      { k: '⌘Enter', d: 'Cycle a line: text → ☐ → ☑ → text. Ticking anywhere updates it everywhere.' },
      { k: 'Show completed', d: 'Toggle on the Todos page to also list finished tasks.' }
    ]
  },
  {
    title: 'Properties & typed tags',
    note: 'Frontmatter is a database you didn’t have to set up.',
    rows: [
      { k: 'properties', d: 'The right panel edits a note’s YAML frontmatter — text, number, date, checkbox, list, select. Plain Markdown on disk.' },
      { k: 'Schema', d: 'Any tag’s page can take fields. Adding the first one makes it a typed tag, stored as a note under Tags/. Tags without fields cost nothing.' },
      { k: '▤ badge', d: 'Marks a tag that has a schema. Typed tags sort first on the Tags page.' },
      { k: 'tag page', d: 'A typed tag lists every note carrying it in a table, one column per field — sortable, editable.' },
      { k: 'Tilsa #person', d: 'Type a name then a typed tag → the name becomes an entity with its own note. The #tag is consumed; a [[link]] stays.' },
      { k: 'click an entity', d: 'A typed entity shows a badge; click to expand and edit its fields inline. ⌘-click opens its page.' },
      { k: 'extends', d: 'In a tag note’s frontmatter, inherits a parent tag’s fields.' },
      { k: 'Remove', d: 'On a tag’s page — deletes its schema. The tag itself stays on your notes; nothing is rewritten.' }
    ]
  },
  {
    title: 'Queries — building blocks',
    note: 'A live list of matching blocks, embedded in a note. Terms AND together.',
    rows: [
      { k: '/query', d: 'Insert a query (or type {{query …}}). Uppercase OR splits alternatives.' },
      { k: '#tag', d: 'Carries that tag — inline or via the note’s tags: property. Hierarchical: #project also matches #project/alpha.' },
      { k: '[[Page]]', d: 'Links to that page.' },
      { k: 'todo / done', d: 'Incomplete / complete tasks (checkboxes stay tickable).' },
      { k: 'word', d: 'Contains that text. Multiple words must all appear.' },
      { k: '-#tag  -word', d: 'A leading - excludes.' },
      { k: 'before: / after:', d: 'Filter by note date (YYYY-MM-DD) — a daily note’s day, else its date: property.' },
      { k: 'prop:key=value', d: 'The note has that frontmatter property (prop:key alone checks it exists).' }
    ]
  },
  {
    title: 'Queries — shaping & recipes',
    rows: [
      { k: 'sort:key', d: 'Order by date, name, path, text, line or status. Prefix - to reverse. Rows with nothing to sort by go last.' },
      { k: 'limit:N', d: 'Keep at most N. Applied after sorting, so “sort:-date limit:10” really is the ten most recent.' },
      { k: 'group:key', d: 'Bucket by note, tag, date or status.' },
      { k: 'as:table', d: 'Render as a table instead of a list.' },
      { k: '{{query #project todo}}', d: 'Open tasks tagged #project.' },
      { k: '{{query #work OR #home}}', d: 'Blocks tagged either.' },
      { k: '{{query todo -#someday after:2026-01-01}}', d: 'Open tasks from this year, skipping #someday.' },
      { k: '{{query todo sort:-date limit:10 group:note}}', d: 'Your ten most recent open tasks, by note.' },
      { k: 'tip', d: 'Stack query blocks in one note to build a dashboard. For saved views over properties, use a Base.' }
    ]
  },
  {
    title: 'Bases',
    note: 'Obsidian-style database views. Stored in the vault, not in a note.',
    rows: [
      { k: '▤ Bases', d: 'Build a filtered table or gallery over your notes’ frontmatter — columns are properties.' },
      { k: '{{base Name}}', d: 'Embed a saved base read-only in any note. Add limit:N or layout:gallery.' },
      { k: 'query vs base', d: 'A query finds BLOCKS by text/tag. A base tabulates NOTES by their properties. Reach for a base when you want columns.' }
    ]
  },
  {
    title: 'Outline & blocks',
    rows: [
      { k: 'Tab / ⇧Tab', d: 'Indent / outdent — children move with the block.' },
      { k: 'click a bullet', d: 'Zoom into that block. ▸ / ▾ folds a section.' },
      { k: 'drag a bullet', d: 'Move the block and its children.' },
      { k: '⌘↑ / ⌘↓', d: 'Fold / unfold the current block (⌘. toggles).' },
      { k: '⌥⌘↑ / ⌥⌘↓', d: 'Fold / unfold everything.' },
      { k: 'Enter on a parent', d: 'Expanded: new first child. Folded: new sibling below the hidden section.' },
      { k: 'Enter on empty bullet', d: 'Outdents, then exits the list.' },
      { k: 'drag / ⇧-click', d: 'Select multiple whole blocks.' },
      { k: '⌘A ⌘A ⌘A', d: 'Select the block’s text → the block + subtree → the whole view.' },
      { k: '⌥↑ / ⌥↓  ·  ⇧↑ / ⇧↓', d: 'Start a block selection · grow or shrink it.' },
      { k: '⌘⇧↑ / ⌘⇧↓', d: 'Move the block (or selection) up / down.' },
      { k: '⌘C / ⌘X / ⌘V', d: 'Copy / cut / paste whole blocks, across notes too.' },
      { k: '⌘Z / ⌘⇧Z', d: 'Undo / redo edits.' }
    ]
  },
  {
    title: 'Canvas',
    note: 'An infinite whiteboard, saved as a portable .canvas file.',
    rows: [
      { k: 'double-click', d: 'Drop a text card. Or ＋ Text / ＋ Note / ＋ Link; drag a note in from the sidebar.' },
      { k: 'scroll · ⌘-scroll', d: 'Two-finger scroll (or space-drag) pans; pinch or ⌘-scroll zooms. ⌘0 resets, ⤢ zooms to fit.' },
      { k: 'drag a side dot', d: 'Hover a card for its ports; drag one to another card to draw an arrow.' },
      { k: 'drag · ⇧-click', d: 'Marquee-select; ⇧-click adds. Colour, duplicate (⌘D) or delete (⌫) from the floating toolbar.' },
      { k: '⌘Z / ⌘⇧Z', d: 'Undo / redo on the canvas. Autosaves.' }
    ]
  },
  {
    title: 'Bigger tools',
    rows: [
      { k: 'PDF', d: 'Open a PDF in a split, highlight text, and each highlight flows back into your note as a linkable reference.' },
      { k: 'Compile', d: 'From a note’s ⋯ menu: stitches a hub note and everything it links to into one linear document, headings demoted per depth.' },
      { k: '❧ Tend', d: 'Suggested connections (notes co-mentioned but unlinked), orphans, stubs, stale notes, broken links.' },
      { k: 'Templates', d: 'Any .md in Templates/. /template inserts one into the current note; New ▾ creates from one. {{date}} and {{title}} are filled in.' },
      { k: 'find & replace', d: 'In-note find and replace from the ⋯ menu.' },
      { k: 'spellcheck', d: 'Whole-note spellcheck; right-click a squiggle for suggestions or to add it to the vault’s ignore list.' }
    ]
  },
  {
    title: 'Appearance & vaults',
    rows: [
      { k: 'themes', d: 'Settings → Dark, Paper (warm light, grain, serif) or Light, plus six accents.' },
      { k: 'editor font', d: 'Sans / Serif / Mono and a size, independent of the theme.' },
      { k: '.verso/custom.css', d: 'Drop CSS in your vault to restyle anything. It hot-reloads on save.' },
      { k: 'multiple vaults', d: 'Open several folders and swap between them from the top of the sidebar.' }
    ]
  }
]

export function Help({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => inputRef.current?.focus(), [])

  // Match the section title too, so "canvas" surfaces the whole Canvas section
  // rather than only the rows that happen to repeat the word.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return SECTIONS
    return SECTIONS.map((s) => {
      if (s.title.toLowerCase().includes(needle)) return s
      const rows = s.rows.filter(
        (r) => r.k.toLowerCase().includes(needle) || r.d.toLowerCase().includes(needle)
      )
      return rows.length ? { ...s, rows } : null
    }).filter((s): s is Section => s !== null)
  }, [q])

  const hits = shown.reduce((n, s) => n + s.rows.length, 0)

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal help-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Help &amp; shortcuts</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="help-filter-wrap">
          <input
            ref={inputRef}
            className="help-filter"
            value={q}
            placeholder="Filter — try “tag”, “query”, “fold”…"
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <span className="help-hits">{hits}</span>}
        </div>
        <div className="help-body">
          {shown.map((s) => (
            <div className="help-section" key={s.title}>
              <div className="help-section-title">{s.title}</div>
              {s.note && !q && <div className="help-section-note">{s.note}</div>}
              {s.rows.map((r) => (
                <div className="help-row" key={r.k + r.d}>
                  <kbd className="help-key">{r.k}</kbd>
                  <span className="help-desc">{r.d}</span>
                </div>
              ))}
            </div>
          ))}
          {shown.length === 0 && <div className="help-empty">Nothing matches “{q}”.</div>}
          <div className="help-foot">
            Everything is plain Markdown on disk — notes, frontmatter properties, tags and links are
            all standard <code>.md</code>, so your vault stays portable.
          </div>
        </div>
      </div>
    </div>
  )
}
