# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-first notebook desktop app (Electron + React 19) that stores everything as plain
Markdown `.md` files on disk — a mesh of Obsidian (document editing, wikilinks, graph) and
Logseq (outliner, backlinks, journal). Features: a block outliner editor, `[[wikilinks]]`
with autocomplete, backlinks + unlinked references, a force-directed graph, Obsidian-style
"Bases" (database tables over frontmatter), tags, todos, a daily journal, templates, and a
PDF annotator.

**Naming note:** everything is **verso** — the preload bridge is `window.verso` (typed
`VersoApi`), the asset protocol is `verso://`, prefs live in `verso-prefs.json`. Two
one-time migrations rename persisted data from the project's pre-release codename (the
prefs-file rename in `main/index.ts`, the localStorage key rename at the top of
`store.ts`) — don't remove them, and don't reintroduce that codename anywhere.

## Commands

```bash
npm install
npm run dev        # launch the app with HMR (electron-vite dev)
npm run lint       # eslint (see eslint.config.js) — zero warnings tolerated
npm run typecheck  # tsc --noEmit on BOTH tsconfig.node.json and tsconfig.web.json
npm run build      # production bundle into out/
npm run build:mac   # build + electron-builder → dist/Verso-<ver>-arm64.dmg (Apple Silicon, ad-hoc signed)
npm run build:linux # build + electron-builder → Linux x64 AppImage
npm test            # vitest run — unit tests for the parsing/indexing libs
```

`npm run lint` runs ESLint (`eslint.config.js`) — deliberately narrow, since `tsc --strict`
already covers types; it exists mainly for `react-hooks/exhaustive-deps`, which matters here
because the store mutates `texts` in place and hands components long-lived refs, so stale
closures are the likeliest bug. CI runs lint → typecheck → test → build, and lint is
`--max-warnings 0`: an `eslint-disable` comment must come with a reason. `npm test` runs
Vitest over the pure parsing/indexing libs (`src/**/*.test.ts`). Run all three after changes.
TypeScript is `strict`. When opening the app, point it at `sample-vault/` (an interlinked set
of demo notes) to exercise the features.

## Architecture

Three Electron contexts, wired by electron-vite (`electron.vite.config.ts`). The renderer
**never touches the filesystem** — all I/O crosses the preload bridge.

```
renderer (React)  ──window.verso──▶  preload (contextBridge)  ──ipcRenderer.invoke──▶  main
   src/renderer/                          src/preload/index.ts                    src/main/{index,workspace}.ts
```

- **`src/shared/types.ts`** — the contract between processes. `VersoApi` is the full IPC
  surface; `NoteFile` / `NoteContent` / `ParsedNote` / `LinkRef` are the core data shapes.
  Edit this first when adding an IPC method, then preload, then a `main` `ipcMain.handle`.
- **`src/shared/media.ts`** — the single list of media extensions, imported by both
  processes (`MEDIA_EXT_SET` for main's watcher/protocol, `FILE_LINK_RE` for the renderer's
  "this link is an asset, not a phantom note" filter). Add a format here and nowhere else.
- **`src/main/index.ts`** — window creation, IPC handlers, CSP (permissive in dev, strict in
  prod), and the `verso://` custom protocol that serves workspace assets (images/PDFs) to
  the renderer. Remembers the last workspace in `userData/verso-prefs.json`.
- **`src/main/workspace.ts`** — all disk access, scoped to the chosen workspace root. All
  writes are atomic (`atomicWrite`: temp file + rename) and return a `WriteResult`
  (`{ok} | {ok:false,error}`) so the renderer can surface failures. A chokidar watcher
  forwards `add`/`change`/`unlink`/`rename` (paired unlink+add) as `file-event` IPC pushes —
  for notes, `.canvas` files, assets, `.verso/bases.json`, and `.verso/custom.css`; the app's
  own writes are echo-suppressed for 2.5s. Ignores `.git`, `node_modules`, `.obsidian`,
  `.octarine`, `.trash`, dot-dirs, and `.verso` (except the two watched files). Also hosts
  the bases file I/O (`readBases`/`writeBases` → `<root>/.verso/bases.json`) and
  `readCustomCss` (`<root>/.verso/custom.css`).

### Renderer state — `src/renderer/src/store.ts` (Zustand)

This single store is the heart of the app; read it before changing renderer behavior. It
holds three parallel maps keyed by note path — `texts` (raw markdown), `parsed`
(`ParsedNote`), and `index` (a `VaultIndex`) — plus navigation/view state.

Key invariants and patterns:
- **The vault hydrates in the background.** Opening a workspace reads ONLY the note about
  to be shown, then paints — the file tree comes from `ws.files` (stat'd by the main
  process), so the vault is navigable immediately. `hydrateVault` then streams the rest in
  `HYDRATE_CHUNK`-sized `readNotes` batches, mutating `texts`/`parsed` in place (spreading a
  growing map per batch is quadratic), and builds the index once at the end. Consequences:
  `vaultLoading` is true meanwhile and vault-WIDE derivations (search, backlinks, graph,
  queries) are incomplete until it clears — the sidebar says so; opening a note that hasn't
  streamed in yet must go through `ensureLoaded`, or it renders blank; and a hydration pass
  captures `loadGen` and aborts if the vault is switched under it.
- **Two debounces.** Edits update `texts`/`parsed` synchronously but (a) flush to disk via
  per-path buffered writes after 600ms (`pending` map → `flushAll`), and (b) rebuild the
  `VaultIndex` after 200ms (incrementally via `withContentChanges` when it can). So
  backlinks/queries/graph are *eventually consistent* with the editor; don't assume the
  index reflects the latest keystroke.
- **`texts` is mutated IN PLACE** on the typing hot path (the map identity never changes),
  so `useStore((s) => s.texts)` is a bug — the selector never fires. Subscribe to
  `textsTick` (or a per-path `s.texts[path]`, which does change) and read the map through
  `useStore.getState()`. Likewise `parsedChanges` reports which paths were re-derived, so
  consumers can react to *foreign* edits without diffing the whole `parsed` map.
- **All disk writes go through `queueWrite`** — a per-path promise chain, so a debounced
  flush and an immediate write (properties, task toggle) can never land out of order. A
  failed write sets `saveError`, shown as a toast by App.tsx. Never call
  `window.verso.writeNote` directly from the store.
- **Watcher vs. local edits.** `applyFileEvent` skips `change` events for paths with pending
  unsaved buffers (`isPending`) to avoid clobbering the editor. Async file events read first,
  then merge onto fresh state via functional `set` updates so bursts don't overwrite.
- **Frontmatter is preserved separately from the body.** `setNoteBody` keeps frontmatter,
  `editNote` replaces full text. Use `setNoteProperties` (writes immediately, bypassing the
  buffer) for frontmatter; `_order`, `pinned`, `_types` (per-property type overrides), and
  `_tableWidths` (per-table column widths, keyed by the table block's ordinal) are app-managed
  `_`-prefixed frontmatter keys. `toggleTask` also writes through immediately so a
  checkbox toggle survives an instant quit (and App.tsx flushes pending writes on window hide/close).
- **Per-vault data lives in the vault, not localStorage.** Bases are stored in
  `<root>/.verso/bases.json` (loaded in `bootstrap`/`openWorkspace`, saved by `setBases`), with
  a one-time migration from the old `verso-bases` localStorage key. Don't reintroduce
  localStorage for vault data — it splits between the dev (`localhost`) and packaged (`file://`) origins.
- Navigation is panes, not tabs: a main pane (with back/forward `history`, capped at 200
  steps) plus any number of right-hand splits (`sidePanes: SidePane[]` — cmd-clicked notes /
  open PDFs; `closeSidePane(i?)` closes one). `view` switches the main pane between the
  editor and the graph/bases/journal/todos/assets/tags screens.
- Appearance: `theme` (`ThemeName`: dark / paper / light) + `accent` (see `ACCENTS`) live in
  localStorage; `customCss` mirrors the vault's `.verso/custom.css` and is injected/hot-reloaded
  by App.tsx. **Paper is a LIGHT theme** (warm cream, `html[data-theme='paper']` in
  `styles/panels.css`) — anything that branches on lightness must test `theme === 'dark'`, not
  `theme === 'light'`, or paper silently gets the dark treatment (see App.tsx's accent effect
  and the `:is([data-theme='light'], [data-theme='paper'])` hljs overrides).

### Editor — custom, NOT CodeMirror

The README mentions CodeMirror, but the editor is now a bespoke block outliner. (There is no
`codemirror` dependency.)
- **`components/BlockEditor.tsx`** — the outliner: `<textarea>`-per-block editing, indent/outdent,
  folding, drag-reorder, block multi-select, word-level undo, `[[`-autocomplete, a fixed
  formatting toolbar (`.fmt-bar`, sticky at the top of each editor; `applyInline` toggles
  inline markers — also ⌘B/⌘I/⌘E — and `setBlockKind` toggles heading/bullet/todo), and a `/`
  command menu (`SLASH_COMMANDS`: Insert template, headings, todo, bullet, table, query, base).
  Renders `{{query …}}`/`{{base …}}` blocks as embeds, `---` as `<hr>`, and a trailing
  click-to-write tail. `/template` (and the sidebar right-click "Apply template") merge a
  template's frontmatter + body into the CURRENT note via `applyTemplateToNote`/`insertTemplate`.
- **`components/BlockRow.tsx`** — one memoized outliner row; a keystroke re-renders only the
  edited block. Rows read the latest editor closures through a `RowApi` ref and re-render on
  scalar prop changes plus a `dataTick` that bumps when parsed/files/index/spellcheck change.
  If you add a field to `Block`, the row's shallow compare picks it up automatically.
  Non-editing rows carry `.bl-cv` (`content-visibility: auto`) so the browser skips layout
  and paint for offscreen rows while keeping them in the DOM — which drag-reorder, the
  find-scroll, and PDF export all depend on. Never put it on the editing row: the paint
  containment it brings would clip the `[[`/`/` autocomplete popup.
- **`components/useBlockDrag.ts`** / **`useFindReplace.ts`** — drag-reorder and in-note
  find & replace, extracted from the editor. `useBlockDrag` reads only refs, which is why
  its document listeners subscribe once instead of re-binding per keystroke; keep it that way.
- **`components/caret.ts`** — `CaretPos` / `PendingCaret`: where to put the caret once the
  next textarea mounts (it can't be placed at the call site — the element doesn't exist yet).
- **`lib/blocks.ts`** — block model: parse/serialize markdown ↔ `Block[]`, indentation,
  shortcut detection, visible/foldable logic. The editor's data layer. Round-trips preserve
  `^block-anchor` markers (`Block.anchor`) and ordered-list numbering (`Block.ordinal`).
  Consecutive `>` lines fold into ONE `quote` block with the markers stripped (a bare `>` is a
  blank line inside it), so a callout's whole body is a single block.
- **`components/MermaidBlock.tsx`** + **`lib/mermaid.ts`** — a ```` ```mermaid ```` fence
  renders as a diagram instead of code (dispatched from `renderRich`'s `code` branch on
  `Block.lang`). `renderMermaid` is the ONE seam to the engine: it lazy-imports `mermaid`,
  maps the app's CSS variables onto mermaid's `base` theme, and returns an SVG string — swap
  the renderer there and nothing else moves. Parse errors surface as the source plus the
  message; the row's own `.bl-code` frame supplies the chrome, so the block adds none.
- **`components/Callout.tsx`** + **`lib/callouts.ts`** — a `quote` block whose first line is
  `[!kind] Title` renders as an Obsidian-style callout. **Nothing about a callout is stored on
  the `Block`** — `parseCallout` derives it from the quote's text on every render, which is why
  it round-trips to disk as the plain Markdown blockquote it already is. Add a kind to
  `CALLOUTS` plus one `--callout` line in `styles/editor.css` and it works everywhere quotes
  render. Fold state is component-local: the `-` marker sets only the STARTING state, so
  collapsing a callout never rewrites the note.
- **`components/Math.tsx`** + **`lib/math.ts`** — `$…$` inline and `$$…$$` display LaTeX via
  KaTeX, lazy-imported behind `renderMath` (same one-seam shape as `mermaid.ts`); the
  stylesheet is imported *inside* the lazy module so the CSS and its ~60 web-font files land
  in that chunk rather than at app start. **KaTeX is a direct dependency on purpose** even
  though mermaid also pulls it in — a mermaid minor could drop or bump it and break math for
  reasons nothing in `math.ts` would explain. `MATH_INLINE_SRC` is the `$…$` delimiter rule as
  a regex *source fragment*, spliced into `InlineMarkdown`'s alternation and unit-tested in
  `math.test.ts`; its guards are what keep "it costs $5 and $10" from rendering as math.
  Display math is matched in `renderRich` off paragraph text (like `---` → `<hr>`) rather than
  being a `BlockType`, so it stays plain text on disk.
- **`components/InlineMarkdown.tsx`** (`renderInline`) — renders inline markdown (bold,
  links, tags) for non-focused blocks, backlinks, todos, and previews. Pass `noPreview` to
  suppress the ⌘-hover link preview (used inside the preview popup to avoid recursion).
  `MD_RE` is one big alternation and **group numbers are positional** — append new syntax at
  the END so existing `m[n]` branches don't shift. Order is also precedence: `` `code` ``
  sits before math, so `` `$x$` `` stays literal.

### Parsing & indexing — `src/renderer/src/lib/`

- **`parse.ts`** (`parseNote`) — turns raw text into a `ParsedNote` (frontmatter, links,
  tags, excerpt), code-aware so `[[ ]]`/`#` inside code blocks are ignored.
- **`vault.ts`** (`VaultIndex`) — built from all parsed notes; computes backlinks, unlinked
  references, and graph data (`GraphNode`/`GraphLink`, including phantom/unresolved notes).
  **`withContentChanges` is not a snapshot API**: the handle it returns aliases the
  receiver's derived maps (that's what makes the patch O(edited notes)), so the old handle is
  *superseded*, not preserved. Never hold an index across a rebuild expecting frozen data;
  compare `version` if you need to tell generations apart. Unlinked references are scanned
  per SOURCE note with one combined name-alternation regex and cached by source, so an edit
  re-scans only the note you typed in. `{{query}}` blocks are scanned **lazily** (`blocksFor`)
  — they're needed only by queries, so scanning every note up front made every user pay a
  second full pass over the vault at startup.
- **`links.ts`** — wikilink resolution (`resolveTarget`, `pathForNewNote`), path helpers
  (`basename`/`dirname`/`stripMd`), and `rewriteLinks` used when renaming notes (code-aware:
  skips fenced/inline code via `md.ts`'s shared `codeRanges`).
- **`frontmatter.ts`** — YAML frontmatter get/parse/replace, built on the `yaml` package's
  Document API so edits preserve comments, key order, and formatting of untouched keys.
- **`query.ts`** — the `{{query ...}}` query language, rendered by `QueryView`. Grammar
  v4 (documented in the file header): AND within a group, uppercase `OR` between groups,
  `-` negation, hierarchical `#tag` (matches `#tag/sub`), `before:`/`after:` dates,
  `prop:key[=value]`, todo/done, `[[Page]]`, words — plus **directives** that shape rather
  than filter: `sort:key` (`-` prefix reverses; missing values always sink), `limit:N`
  (after sorting), `group:key` (after limiting, first-appearance order),
  `as:list|table|gallery`, `scope:blocks|notes` and `cols:a,b,c`.
  **`scope:notes` makes each row a NOTE**, matched by `matchNote` against the note's own
  tags/links/props rather than by any of its blocks matching — a note whose content is
  entirely frontmatter has no blocks at all, and those are exactly the notes such a query is
  looking for. `sort:` is the one directive where an unknown key is NOT degraded to a word
  term: it's read as a property name, so `sort:-Year` orders by frontmatter (degrading it
  made the query silently search for the literal text "sort:-year").
  `runQuery` returns the shaped `QueryResult` — `blocks` XOR `notes`.
- **`components/QueryBuilder.tsx`** — the visual builder behind `/query` and the `⚙ edit`
  button on a rendered query. It COMPOSES the query string and re-seeds itself from one
  (`condsFrom`); the text stays the source of truth and remains hand-editable, so nothing the
  builder can't model is lost — an `OR` query simply opens in text mode rather than being
  silently flattened on save.
- **`md.ts`'s `embedRanges`** — the spans of `{{query}}`/`{{base}}` blocks, skipped by
  `parseNote` alongside code. Their `#tags` and `[[links]]` are search *criteria*, not
  content: counting them made every query match the very note that contained it.
- **`compile.ts`** — Compile mode: DFS-stitches a hub note + its wikilinked notes (reading
  order, cycle-safe, depth/count caps) into one linear document — headings demoted per depth,
  `^anchors` stripped, links optionally flattened. Rendered by `CompileView` (the `compile`
  modal, opened from the page ⋯ menu / palette on the active note).
- **`tend.ts`** — the Tend ("gardener") report: suggested connections (note names co-mentioned
  without links, one combined-alternation scan), orphans, stubs, stale notes, broken links.
  Rendered by `TendView` (sidebar `❧ Tend`, `view: 'tend'`).
- **`bases.ts`** — Base type + filtering helpers (no storage; persistence is the vault file
  above). **`components/BaseView.tsx`** is the shared renderer (table/gallery) used by both the
  Bases page (`BasesView`, interactive) and inline `{{base <name> [limit:N] [layout:…]}}`
  embeds (`BaseEmbed`, read-only). Templates are derived live from the `Templates/` folder
  (`templatesFromFiles`) — there is no `listTemplates` IPC.

### Typed tags ("supertags") — `src/renderer/src/lib/supertags.ts`

Tana-style typed tags. **There is ONE user-facing concept: a tag.** A tag with a schema is
backed by a note under `Tags/` whose frontmatter declares `fields:` (types:
text/number/date/checkbox/list/link/select) and optional `extends:` parents; a tag with no
schema is backed by nothing at all. The code still calls the backed kind a *supertag* (the
type, the store actions, this file) — that's an implementation word, deliberately **not** in
the UI, which says "tag" and "Schema" throughout.

- **The definition note is created lazily**, on the first field added from a tag's page
  (`TagsView`'s `SchemaEditor` → `createSupertag` → `setSupertagFields`; `createSupertag`
  returns the def path for exactly this). This is load-bearing: minting a file per `#tag`
  would put a stub in the file tree, the graph, search and Tend for every casual `#idea`.
  `SchemaEditor` therefore renders for EVERY active tag, with `st` undefined until promotion.
- **The Tags page lists tags from two sources** — tags used by notes, and definition notes
  (which do *not* tag themselves). Merging both is what makes a schema'd-but-unused tag
  visible; forgetting it is a bug that has bitten once already. Typed tags sort first and
  carry the `▤` badge.
- `fields:`/`extends:` are schema, not user data: `isSupertagSchemaKey` hides them from the
  Properties panel on `Tags/` notes only (an ordinary note may have a `fields` property, and
  a nested map rendered as a generic row shows up as `[object Object]`).

Any note carrying the tag (frontmatter `tags:`) is an **entity** exposing those fields.
Authoring: typing `<name> #<tag> ` in the editor auto-creates/links an entity note, applies
the tag, and rewrites the line to `[[name]]` (the `#tag` is consumed) — handled in
`BlockEditor`'s `onChange`. A linked entity renders as a chip with a type badge
(`InlineMarkdown` `cm-entity`); clicking expands `EntityCard` (edits write to the entity's
frontmatter via the shared, exported `ValueEditor` in `PropertiesPanel`). A typed tag's page
lists all instances in a table, one column per field. Store surface: `applySupertag` /
`ensureEntity` / `createSupertag` / `setSupertagFields`.

### Cross-component buses

`lib/notebus.ts`, `lib/pdfbus.ts` and `lib/formatbus.ts` are small pub/sub channels used where
the store isn't the right owner — e.g. the PDF pane pushing a block into the live note editor, or scrolling a
PDF to a highlight. The block editor owns its own block state, so inserts go through the bus
rather than the store. `formatbus` carries the same idea to the toolbar: the journal stacks a
`BlockEditor` per day, so `components/FormatBar` is lifted to the top of that page and the
focused editor publishes its `applyInline`/`setBlockKind` closures for it to drive. The slot is
released on blur only by the editor that still owns it (`owner` symbol) — clicking straight
from one day into another publishes the new editor before the old one's cleanup runs. A normal
note passes `toolbar="always"` and renders its own bound bar instead.

## Gotchas

- **pdfjs-dist is pinned to v4** (`^4.10.38`); v5 dropped APIs this code relies on. The PDF
  worker and the lib are lazy-loaded (`App.tsx`) because they're large.
- Adding an IPC call means touching four files in order: `shared/types.ts` (`VersoApi`) →
  `preload/index.ts` → `main/index.ts` (`registerIpc`) → `main/workspace.ts`.
- Import aliases: `@/*` → `src/renderer/src/*`, `@shared/*` → `src/shared/*`.
- `styles.css` is just an ordered list of `@import`s from `styles/` (Vite inlines them).
  **The order is load-bearing** — later files, notably the light-theme overrides, depend on
  following earlier ones. Move a rule between files only if it keeps its relative position.
- Assets referenced in notes must be served through `verso://` (handled in `main/index.ts`);
  the renderer can't read files by path. New images are saved into the workspace `assets/` folder.
