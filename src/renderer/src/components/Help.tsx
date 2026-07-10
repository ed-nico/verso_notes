import { useEffect } from 'react'

interface Row {
  /** Key combo or syntax (rendered as a chip). */
  k: string
  /** What it does. */
  d: string
}
interface Section {
  title: string
  rows: Row[]
}

const SECTIONS: Section[] = [
  {
    title: 'Find & navigate',
    rows: [
      { k: '⌘K  /  ⌘P', d: 'Command palette — jump to any note (filename or full-text), or run a command.' },
      { k: 'Search box', d: 'Searches note titles and body text; shows a matching snippet.' },
      { k: '# Tags', d: 'Browse every tag with counts; click a #tag in a note to open it.' },
      { k: 'drag a note', d: 'Reorder notes within a folder, or drop onto a folder to move it in.' },
      { k: 'New ▾', d: 'Create a note from a template (Markdown files in a Templates/ folder).' }
    ]
  },
  {
    title: 'Links & backlinks',
    rows: [
      { k: '[[Page]]', d: 'Link to a page. Type [[ to search and pick a page.' },
      { k: '[[Page|alias]]', d: 'Link with custom display text.' },
      { k: 'paste a URL', d: 'A web link autolinks; on its own line it fetches the page title. A YouTube/Vimeo/Loom link embeds an in-app player.' },
      { k: '⌘;', d: 'While a video plays, stamp the current play time into your note. Click the timestamp later to jump the video there.' },
      { k: 'backlinks', d: 'Every note lists what links to it (and unlinked name mentions) at the bottom.' }
    ]
  },
  {
    title: 'Queries — building blocks',
    rows: [
      { k: '/query', d: 'Insert a query (or type {{query …}}). Shows a live list of matching blocks. Terms combine with AND; uppercase OR splits alternatives.' },
      { k: '#tag', d: 'Carries that tag — inline #tag OR the note’s tags: property. Hierarchical: #project also matches #project/alpha.' },
      { k: '[[Page]]', d: 'Links to that page.' },
      { k: 'todo / done', d: 'Incomplete / complete tasks (checkboxes stay tickable).' },
      { k: 'word', d: 'Contains that text. Multiple words must all appear.' },
      { k: '-#tag  -word', d: 'A leading - excludes: blocks with that tag / page / word are dropped.' },
      { k: 'before: / after:', d: 'Filter by note date (YYYY-MM-DD) — a daily note’s day, else the note’s date: property.' },
      { k: 'prop:key=value', d: 'The note has that frontmatter property (prop:key alone checks it exists).' }
    ]
  },
  {
    title: 'Queries — recipes (copy these)',
    rows: [
      { k: '{{query #project todo}}', d: 'Open tasks tagged #project.' },
      { k: '{{query #work OR #home}}', d: 'Blocks tagged either #work or #home.' },
      { k: '{{query [[Project Alpha]] done}}', d: 'Completed items that mention [[Project Alpha]].' },
      { k: '{{query todo -#someday after:2026-01-01}}', d: 'Open tasks from this year, skipping #someday.' },
      { k: '{{query prop:status=active #idea}}', d: '#idea blocks in notes whose status property is “active”.' },
      { k: 'tip', d: 'Stack several query blocks in one note to make a dashboard. For richer filtering (group, totals, gallery), use a Base instead.' }
    ]
  },
  {
    title: 'Writing (type these at the start of a line)',
    rows: [
      { k: '# ', d: 'Heading (## , ### for levels).' },
      { k: '- ', d: 'Bullet.' },
      { k: '[] ', d: 'Task / checkbox. ⌘Enter cycles a line: text → ☐ → ☑ → text.' },
      { k: '```', d: 'Code block.' },
      { k: '/', d: 'Slash menu — type / on an empty line for a command menu: Insert template, headings, to-do, bullet, table, query.' },
      { k: '/ → Insert template', d: 'Pick a template from the Templates/ folder; its {{date}}/{{title}} variables are filled in and its content is inserted here.' },
      { k: '**bold**  _italic_', d: '⌘B / ⌘I also wrap the selection. Also `code`, ~~strike~~.' },
      { k: '![400](url)', d: 'Image — the number is the max width in px. #tag tags anywhere.' }
    ]
  },
  {
    title: 'Todos & due dates',
    rows: [
      { k: '- [ ] task', d: 'Any line starting with - [ ] is an open todo (- [x] is done). The Todos page collects them from every note.' },
      { k: '@2026-06-20', d: 'Add a due date inline. The todo is grouped on the Todos page as Overdue / Today / Upcoming.' },
      { k: 'in a daily note', d: 'A todo with no due date written in a daily note is scheduled for that day’s date.' },
      { k: '⌘Enter', d: 'On a line, cycle text → ☐ → ☑ → text. Ticking a checkbox anywhere updates it everywhere.' },
      { k: 'Show completed', d: 'Toggle on the Todos page to also list finished tasks.' }
    ]
  },
  {
    title: 'Supertags (typed tags)',
    rows: [
      { k: '＋ Supertag', d: 'On the Tags page, create a supertag — a tag that defines a schema of fields. It is a note under Tags/.' },
      { k: 'fields', d: 'Add fields (text, number, date, checkbox, list, link, select) on the supertag’s page; extends: inherits a parent supertag’s fields.' },
      { k: 'Tilsa #person', d: 'Type a name then a supertag → the name becomes a typed entity (its own note, tagged). The #tag is consumed; a [[link]] stays.' },
      { k: 'click an entity', d: 'A typed entity shows a type badge; click it to expand & edit its fields inline. ⌘-click opens its page.' },
      { k: 'tag page', d: 'A supertag’s page lists every instance in a table, one column per field.' }
    ]
  },
  {
    title: 'Canvas (whiteboard)',
    rows: [
      { k: '▱ Canvas', d: 'Open the Canvas view (sidebar). An infinite space to arrange cards and connect them; each board is a portable .canvas file.' },
      { k: 'double-click', d: 'Drop a text card anywhere. Or use ＋ Text / ＋ Note / ＋ Link in the toolbar; drag a note in from the sidebar to add it as a card.' },
      { k: 'scroll · ⌘-scroll', d: 'Two-finger scroll (or space-drag) pans; pinch or ⌘-scroll zooms. ⌘0 resets to 100%, ⤢ zooms to fit.' },
      { k: 'drag a side dot', d: 'Hover a card to reveal its connection ports; drag from one to another card to draw an arrow.' },
      { k: 'drag · ⇧-click', d: 'Drag the background to marquee-select; ⇧-click adds cards. Colour, duplicate (⌘D) or delete (⌫) from the floating toolbar.' },
      { k: '⌘Z / ⌘⇧Z', d: 'Undo / redo on the canvas. Everything autosaves to the .canvas file.' }
    ]
  },
  {
    title: 'Outline',
    rows: [
      { k: 'Tab / ⇧Tab', d: 'Indent / outdent — children move with the block.' },
      { k: 'click a bullet', d: 'Zoom into that block. ▸ / ▾ folds a section.' },
      { k: 'drag a bullet', d: 'Move the block and its children; drag right/left while holding to nest or un-nest.' },
      { k: '⌘↑ / ⌘↓', d: 'Fold / unfold the current block (⌘. toggles).' },
      { k: '⌥⌘↑ / ⌥⌘↓', d: 'Fold / unfold everything in the current view.' },
      { k: 'Enter on a parent', d: 'Expanded: new first child. Folded: new sibling below the hidden section.' },
      { k: 'Enter on empty bullet', d: 'Outdents, then exits the list.' }
    ]
  },
  {
    title: 'Select & move blocks',
    rows: [
      { k: 'drag / ⇧-click', d: 'Select multiple whole blocks.' },
      { k: '⌘A ⌘A ⌘A', d: 'Select the block’s text → the block + its subtree → the whole view.' },
      { k: '⌥↑ / ⌥↓', d: 'Start selecting from a block and extend (Esc selects the current one).' },
      { k: '⇧↑ / ⇧↓', d: 'Grow or shrink the selection.' },
      { k: '⌘⇧↑ / ⌘⇧↓', d: 'Move the block (or selection) up / down.' },
      { k: '⌘C / ⌘X / ⌘V', d: 'Copy / cut / paste whole blocks — across notes too; references follow.' },
      { k: '⌫ / Delete', d: 'Delete the selected blocks.' }
    ]
  },
  {
    title: 'History & navigation',
    rows: [
      { k: '⌘Z / ⌘⇧Z', d: 'Undo / redo edits.' },
      { k: '⌘-click', d: 'Open a note or link in a new split — repeat to open several side by side.' },
      { k: '⌘[ / ⌘]', d: 'Go back / forward.' },
      { k: '⌘\\', d: 'Show / hide the left sidebar.' },
      { k: '⌘⇧\\', d: 'Show / hide the right panel.' },
      { k: '⌘W', d: 'Close the last split.' }
    ]
  }
]

export function Help({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal help-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Help &amp; shortcuts</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="help-body">
          {SECTIONS.map((s) => (
            <div className="help-section" key={s.title}>
              <div className="help-section-title">{s.title}</div>
              {s.rows.map((r) => (
                <div className="help-row" key={r.k + r.d}>
                  <kbd className="help-key">{r.k}</kbd>
                  <span className="help-desc">{r.d}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="help-foot">
            Everything is plain Markdown on disk — notes, frontmatter properties, tags and links are
            all standard <code>.md</code>, so your vault stays portable.
          </div>
        </div>
      </div>
    </div>
  )
}
