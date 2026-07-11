import { create } from 'zustand'
import type { CanvasMeta, FileEvent, NoteFile, ParsedNote, TemplateFile, Workspace } from '@shared/types'
import { parseNote } from './lib/parse'
import { VaultIndex } from './lib/vault'
import { basename, dirname, pathForNewNote, resolveTarget, rewriteLinks } from './lib/links'
import { resetSpell } from './lib/spell'
import { getFrontmatter, parseFrontmatter, replaceFrontmatter } from './lib/frontmatter'
import { applyTemplate } from './lib/templates'
import { dailyPath } from './lib/dates'
import { pdfBus } from './lib/pdfbus'
import { normalizeBases, legacyLocalBases, clearLegacyLocalBases, type Base } from './lib/bases'
import { dropFromScanCache, clearScanCache } from './lib/query'
import { normalizeDoc } from './lib/canvas'
import {
  buildSupertagIndex,
  fieldsToFrontmatter,
  normTag,
  supertagsFromParsed,
  TAGS_DIR,
  type FieldDef
} from './lib/supertags'

// One-time migration: releases before 0.2 persisted these keys under the project's
// pre-release codename. Must run before the store's initial state reads any of them.
if (typeof localStorage !== 'undefined') {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('inkwell-')) continue
    const renamed = 'verso-' + k.slice('inkwell-'.length)
    if (localStorage.getItem(renamed) === null) {
      localStorage.setItem(renamed, localStorage.getItem(k)!)
    }
    localStorage.removeItem(k)
  }
}

export type ViewMode =
  | 'editor'
  | 'graph'
  | 'database'
  | 'journal'
  | 'todos'
  | 'assets'
  | 'tags'
  | 'canvas'
export type ModalKind = 'settings' | 'help' | null

/** One back/forward history step. A note opens the editor; a view step restores a
 *  non-editor screen (Bases/Graph/Tags/Canvas/…) so Back returns where you actually came from. */
export type HistEntry =
  | { kind: 'note'; path: string }
  | { kind: 'view'; view: ViewMode; baseId?: string | null; tag?: string | null; canvasPath?: string | null }

/** Selectable editor fonts (the note-writing area). */
export const EDITOR_FONTS: { key: string; label: string; stack: string }[] = [
  { key: 'sans', label: 'Sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif" },
  { key: 'serif', label: 'Serif', stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif" },
  { key: 'mono', label: 'Mono', stack: 'var(--font-mono)' }
]
export const EDITOR_SIZES = [10, 12, 14, 15, 16, 18, 20]

/** Selectable accent themes: CSS variable overrides applied on the root element. */
export const ACCENTS: { key: string; label: string; accent: string; accentDim: string; link: string }[] = [
  { key: 'indigo', label: 'Indigo', accent: '#7c8cff', accentDim: '#4a4f7a', link: '#8fa1ff' },
  { key: 'teal', label: 'Teal', accent: '#2dd4bf', accentDim: '#1d5c54', link: '#5eead4' },
  { key: 'green', label: 'Green', accent: '#4ade80', accentDim: '#276443', link: '#86efac' },
  { key: 'amber', label: 'Amber', accent: '#f5a524', accentDim: '#6e4f1a', link: '#fbc75a' },
  { key: 'rose', label: 'Rose', accent: '#fb7185', accentDim: '#6e3540', link: '#fda4af' },
  { key: 'mono', label: 'Mono', accent: '#a1a1aa', accentDim: '#4b4b52', link: '#c8c8d0' }
]

/** A side pane holds a cmd-clicked note or a PDF; any number can be open (splits). */
export interface SidePane {
  kind: 'note' | 'pdf'
  path: string
}

interface VersoState {
  workspace: Workspace | null
  /** All vaults the user has opened, most-recent first — for the sidebar switcher. */
  recentVaults: string[]
  files: NoteFile[]
  texts: Record<string, string>
  parsed: Record<string, ParsedNote>
  index: VaultIndex
  /** Global navigation history for back/forward (main pane) — notes and view screens. */
  history: HistEntry[]
  histIndex: number
  /** Right-hand splits: cmd-clicked notes / open PDFs, in open order (N-way split). */
  sidePanes: SidePane[]
  /** The note/view shown in the main (left) pane. */
  activePath: string | null
  view: ViewMode
  /** A pending request to open the in-note find on `path` for `query` (from sidebar search). */
  findRequest: { path: string; query: string } | null
  theme: 'light' | 'dark'
  /** Accent theme key (see ACCENTS). */
  accent: string
  /** Contents of the vault's `.verso/custom.css`, injected into the page (or null). */
  customCss: string | null
  /** Editor font family key (see EDITOR_FONTS) and base font size in px. */
  editorFont: string
  editorFontSize: number
  /** Fetch a pasted URL's page title ("smart titles"). The one feature that makes a
   *  network request on its own — off means the app only loads what notes embed. */
  smartLinkTitles: boolean
  dirty: boolean
  loading: boolean
  /** The last failed disk write ("path: reason"), surfaced as a toast; null when clear. */
  saveError: string | null
  /** Saved base views (Obsidian-style tables/galleries). */
  bases: Base[]
  /** Which base the Bases view should show. */
  activeBaseId: string | null
  /** Spatial canvases (`.canvas` files) in the vault, newest first — for the sidebar. */
  canvases: CanvasMeta[]
  /** Which canvas the Canvas view should show (workspace-relative path). */
  activeCanvasPath: string | null
  /** Tag the Tags view is focused on, or null for the tag index. */
  activeTag: string | null
  /** Which full-screen modal is open (settings/help), or null. */
  modal: ModalKind
  /** Whether the command palette / quick-switcher is open. */
  paletteOpen: boolean
  /** Whether the left sidebar (file tree) is shown. */
  sidebarOpen: boolean
  /** Whether the right sidebar (calendar/properties/TOC/graph) is shown. */
  rightbarOpen: boolean

  toggleTheme: () => void
  setAccent: (key: string) => void
  /** Re-read `.verso/custom.css` from the vault (called on load and on file change). */
  reloadCustomCss: () => Promise<void>
  dismissSaveError: () => void
  toggleSidebar: () => void
  toggleRightbar: () => void
  setEditorFont: (key: string) => void
  setEditorFontSize: (px: number) => void
  setSmartLinkTitles: (on: boolean) => void
  openModal: (modal: Exclude<ModalKind, null>) => void
  closeModal: () => void
  setPalette: (open: boolean) => void
  /** Open the Tags view, optionally focused on one tag. */
  openTag: (tag: string | null) => void
  /** Create a note from a template file and open it. */
  newFromTemplate: (templatePath: string, folder?: string) => Promise<void>
  /** Tag a note with a supertag (adds it to frontmatter `tags`, making the note an instance). */
  applySupertag: (notePath: string, tag: string) => Promise<void>
  /** Resolve (or create) a note named `name` and apply `tag` to it. Returns its path. */
  ensureEntity: (name: string, tag: string) => Promise<string>
  /** Create a new supertag definition note under `Tags/` and open it
   *  (pass `{ open: false }` to create in the background, e.g. from the `#` picker). */
  createSupertag: (name: string, opts?: { open?: boolean }) => Promise<void>
  /** Write a supertag's field schema to its definition note. */
  setSupertagFields: (defPath: string, fields: FieldDef[]) => Promise<void>
  /** Apply `tag` to every note under `folder` (recursively). */
  applySupertagToFolder: (folder: string, tag: string) => Promise<void>
  /** Create a supertag named after `folder`, inferring its fields from the folder's notes,
   *  then tag every note in the folder with it. Opens the new supertag's page. */
  createSupertagFromFolder: (folder: string) => Promise<void>
  /** Apply a template to an EXISTING note: merge its properties + append its body (note's own values win). */
  applyTemplateToNote: (notePath: string, templatePath: string) => Promise<void>
  /** Drag-reorder: move `dragPath` to sit just before `dropPath` among shared siblings. */
  reorderTo: (dragPath: string, dropPath: string) => Promise<void>
  /** Move a note into `folder` (drag-drop onto a folder). */
  moveToFolder: (path: string, folder: string) => Promise<void>
  /** Persist the full set of bases. */
  setBases: (bases: Base[]) => void
  /** Open the Bases view focused on a specific base. */
  openBase: (id: string) => void
  /** Re-scan the vault for `.canvas` files (after create/delete/rename). */
  refreshCanvases: () => Promise<void>
  /** Open the Canvas view, defaulting to the most recent canvas. */
  openCanvasView: () => void
  /** Open the Canvas view focused on a specific canvas file. */
  openCanvas: (path: string) => void
  /** Create a new canvas (under `folder`) and open it. */
  createCanvas: (name: string, folder?: string) => Promise<void>
  /** Send a canvas to the OS trash and drop it from the list. */
  deleteCanvas: (path: string) => Promise<void>
  /** Rename a canvas file; keeps it open if it was active. */
  renameCanvas: (path: string, name: string) => Promise<void>
  bootstrap: () => Promise<void>
  openWorkspace: () => Promise<void>
  /** Switch to an already-known vault by path (flushes pending edits first). */
  switchVault: (root: string) => Promise<void>
  /** Forget a vault from the switcher list (does not delete its files). */
  forgetVault: (root: string) => Promise<void>
  /** Re-scan the workspace folder from disk (recovers files the watcher missed). */
  reloadVault: () => Promise<void>

  // ---- navigation (panes, no tabs) ----
  openNote: (path: string) => void
  /** Open a note and ask its editor to find `query` in it (sidebar search → jump to match). */
  openNoteWithFind: (path: string, query: string) => void
  /** Clear a consumed find request. */
  clearFindRequest: () => void
  /** Open a note in a new right-hand split (cmd/ctrl-click). */
  openInSidePane: (path: string) => void
  openView: (view: ViewMode) => void
  /** Open a PDF in a right-hand split; optionally scroll to a highlight. */
  openPdf: (path: string, highlightId?: string) => void
  /** Close the split at `index` (or the last one when omitted). */
  closeSidePane: (index?: number) => void
  goBack: () => void
  goForward: () => void

  // ---- editing ----
  /** Replace a note's body (frontmatter preserved). Used by block editors (incl. journal). */
  setNoteBody: (path: string, body: string) => void
  /** Replace a note's full text (frontmatter included). Used by the source editor. */
  editNote: (path: string, text: string) => void
  /** Replace the active note's full text. */
  editActive: (text: string) => void
  /** Flush all pending debounced saves to disk. */
  saveActive: () => Promise<void>
  setNoteProperties: (path: string, data: Record<string, unknown>) => Promise<void>
  /** Persist resized column widths for the `index`-th table block (app-managed `_tableWidths`). */
  setTableWidths: (path: string, index: number, widths: number[]) => Promise<void>
  /** Toggle a note's `pinned: true` frontmatter flag. */
  togglePin: (path: string) => Promise<void>
  /** Wrap a plain-text mention of `name` on `sourcePath` line `line` in [[ ]]. */
  linkUnlinked: (sourcePath: string, line: number, name: string) => Promise<void>
  /** Convert every unlinked mention of the note at `path` into a [[link]]. */
  linkAllUnlinked: (path: string) => Promise<void>

  /** Toggle the checkbox on a task line (0-based, full-text line index) of any note. */
  toggleTask: (path: string, line: number) => void

  // ---- navigation helpers ----
  navigate: (raw: string, side?: boolean) => Promise<void>
  ensureDailyNote: (iso: string) => Promise<string>

  // ---- file management ----
  applyFileEvent: (event: FileEvent) => Promise<void>
  renameNote: (oldPath: string, input: string) => Promise<void>
  /** Move a note up/down among its folder siblings (persists via `_order`). */
  reorderNote: (path: string, dir: -1 | 1) => Promise<void>
  deleteNote: (path: string) => Promise<void>
  duplicateNote: (path: string) => Promise<void>
  revealNote: (path: string) => Promise<void>
}

function buildIndex(parsed: Record<string, ParsedNote>, texts: Record<string, string>): VaultIndex {
  return new VaultIndex(Object.values(parsed), texts)
}

/** Templates are simply the notes living under the `Templates/` folder. */
export function templatesFromFiles(files: NoteFile[]): TemplateFile[] {
  return files
    .filter((f) => f.path.startsWith('Templates/'))
    .map((f) => ({ path: f.path, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Wrap the first plain-text (not already-linked) occurrence of `name` in `line` with [[ ]]. */
function wrapMention(line: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^\\w[/])(${esc})(?![\\w\\]/])`, 'i')
  return line.replace(re, (_m, pre: string, nm: string) => `${pre}[[${nm}]]`)
}

async function loadAll(): Promise<{
  texts: Record<string, string>
  parsed: Record<string, ParsedNote>
}> {
  const contents = await window.verso.readAll()
  const texts: Record<string, string> = {}
  const parsed: Record<string, ParsedNote> = {}
  for (const { path, text } of contents) {
    texts[path] = text
    parsed[path] = parseNote(path, text)
  }
  return { texts, parsed }
}

/**
 * Load this workspace's saved Bases from `.verso/bases.json`. One-time migration:
 * any bases still in the old localStorage are merged in (then localStorage is cleared),
 * so bases made in the dev app and the installed app both survive into the vault file.
 */
async function loadWorkspaceBases(): Promise<Base[]> {
  const vault = normalizeBases(await window.verso.readBases())
  const legacy = legacyLocalBases()
  if (legacy.length === 0) return vault
  const ids = new Set(vault.map((b) => b.id))
  const merged = [...vault, ...legacy.filter((b) => !ids.has(b.id))]
  clearLegacyLocalBases()
  await window.verso.writeBases(merged)
  return merged
}

export const useStore = create<VersoState>((set, get) => {
  // Rebuilding the whole vault index (backlinks + block scan over every note) is
  // too heavy to run on every keystroke, so we debounce it. texts/parsed update
  // immediately; index consumers (backlinks, queries, graph) are eventually consistent.
  let indexTimer: ReturnType<typeof setTimeout> | null = null
  // Paths whose text changed during typing but whose `parsed` entry hasn't been
  // re-derived yet — the parse is deferred to the debounce so each keystroke is O(1).
  const dirtyPaths = new Set<string>()
  const scheduleIndexRebuild = (): void => {
    if (indexTimer) clearTimeout(indexTimer)
    indexTimer = setTimeout(() => {
      indexTimer = null
      const texts = get().texts
      let parsed = get().parsed
      const changed: ParsedNote[] = []
      let removed = false
      if (dirtyPaths.size) {
        parsed = { ...parsed }
        for (const p of dirtyPaths) {
          if (texts[p] === undefined) {
            delete parsed[p]
            removed = true
          } else {
            const pn = parseNote(p, texts[p])
            parsed[p] = pn
            changed.push(pn)
          }
        }
        dirtyPaths.clear()
      }
      // Hot path: a pure content edit (no adds/deletes) patches the existing index
      // in O(edited notes); anything else (new/removed note, alias change) falls
      // back to a full rebuild. `withContentChanges` returns null when it can't patch.
      const incremental =
        !removed && changed.length ? get().index.withContentChanges(changed, texts) : null
      set({ parsed, index: incremental ?? buildIndex(parsed, texts) })
    }, 200)
  }
  // Typing hot path: mutate just the changed note's text in place (cloning a 50k-key
  // map every keystroke is what caused input lag at scale) and defer parsing + the
  // index rebuild to the debounce. `parsed`/`index` consumers are eventually consistent.
  const updateText = (path: string, text: string): void => {
    const texts = get().texts
    texts[path] = text
    set({ texts })
    dirtyPaths.add(path)
    scheduleIndexRebuild()
  }
  // Immediate update for one-off writes (properties, task toggles) that aren't
  // per-keystroke — re-derive this note's `parsed` entry right away. The debounced
  // rebuild patches incrementally; `withContentChanges` itself falls back to a full
  // rebuild when the edit could shift resolution vault-wide (alias changes).
  const updateNoteState = (path: string, text: string): void => {
    set({
      texts: { ...get().texts, [path]: text },
      parsed: { ...get().parsed, [path]: parseNote(path, text) }
    })
    dirtyPaths.add(path)
    scheduleIndexRebuild()
  }

  // Per-path write chains: every disk write for a path is appended to that path's
  // chain, so a debounced flush and an immediate write (properties, task toggle)
  // issued mid-flush can never land out of order and clobber each other.
  const writeChains = new Map<string, Promise<void>>()
  const queueWrite = (p: string, t: string): Promise<void> => {
    const chained = (writeChains.get(p) ?? Promise.resolve()).then(async () => {
      const res = await window.verso.writeNote(p, t)
      if (!res.ok) {
        set({ saveError: `Couldn't save ${p}: ${res.error}` })
        // Don't drop the edit: put the text back in the buffer (unless a newer edit
        // is already queued for this path) so a later flush retries the write
        // instead of silently losing the change on quit.
        if (!pending.has(p)) {
          pending.set(p, t)
          set({ dirty: true })
          scheduleFlush(5000) // back off — retrying every 600ms would spam a dead disk
        }
      }
    })
    writeChains.set(p, chained)
    void chained.finally(() => {
      if (writeChains.get(p) === chained) writeChains.delete(p)
    })
    return chained
  }

  // Debounced per-path saves, so multiple editors (e.g. journal days) can be live at once.
  const pending = new Map<string, string>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const flushAll = async (): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    const entries = [...pending.entries()]
    pending.clear()
    set({ dirty: false })
    await Promise.all(entries.map(([p, t]) => queueWrite(p, t)))
  }
  const scheduleFlush = (delay = 600): void => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => void flushAll(), delay)
  }

  /** Load an opened workspace's notes + bases into state, resetting navigation. Shared
   *  by bootstrap / openWorkspace / switchVault so a vault swap always lands cleanly. */
  const applyWorkspace = async (ws: Workspace): Promise<void> => {
    // Drop anything still queued for the previous vault: a buffered write or a
    // debounced index/flush that fired after the swap would land on the new vault.
    pending.clear()
    dirtyPaths.clear()
    if (indexTimer) clearTimeout(indexTimer)
    if (flushTimer) clearTimeout(flushTimer)
    indexTimer = null
    flushTimer = null
    resetSpell() // the new vault has its own spellcheck ignore list
    clearScanCache() // query scan cache entries belong to the previous vault
    const { texts, parsed } = await loadAll()
    const first = ws.files[0]?.path
    set({
      workspace: ws,
      files: ws.files,
      texts,
      parsed,
      index: buildIndex(parsed, texts),
      loading: false,
      dirty: false,
      history: first ? [{ kind: 'note', path: first }] : [],
      histIndex: first ? 0 : -1,
      sidePanes: [],
      activePath: first ?? null,
      view: 'editor'
    })
    const bases = await loadWorkspaceBases()
    set({ bases, activeBaseId: bases[0]?.id ?? null })
    const canvases = await window.verso.listCanvases()
    set({ canvases, activeCanvasPath: canvases[0]?.path ?? null })
    await get().reloadCustomCss()
  }
  /** True if `path` has an unsaved buffered edit (used to avoid watcher clobber). */
  const isPending = (path: string): boolean => pending.has(path)

  /** Show a note in the main pane (no history record). */
  const activateNote = (path: string): void => {
    if (get().dirty) void flushAll()
    set({ activePath: path, view: 'editor' })
  }

  /** Sibling note paths in a folder, ordered by `_order` then name. */
  const siblingPaths = (folder: string): string[] => {
    const { files, parsed } = get()
    const orderOf = (p: string): number => {
      const o = parsed[p]?.frontmatter._order
      return typeof o === 'number' ? o : Number.MAX_SAFE_INTEGER
    }
    return files
      .filter((f) => dirname(f.path) === folder)
      .sort((a, b) => orderOf(a.path) - orderOf(b.path) || a.name.localeCompare(b.name))
      .map((f) => f.path)
  }

  /** Persist a sequential `_order` on the given paths (only where it changed). */
  const persistOrder = async (ordered: string[]): Promise<void> => {
    for (let k = 0; k < ordered.length; k++) {
      const p = ordered[k]
      if (get().parsed[p]?.frontmatter._order !== k) {
        await get().setNoteProperties(p, { ...getFrontmatter(get().texts[p] ?? ''), _order: k })
      }
    }
  }

  const sameEntry = (a: HistEntry | undefined, b: HistEntry): boolean =>
    !!a &&
    a.kind === b.kind &&
    (a.kind === 'note'
      ? a.path === (b as { path: string }).path
      : a.view === (b as { view: ViewMode }).view &&
        a.baseId === (b as { baseId?: string | null }).baseId &&
        a.tag === (b as { tag?: string | null }).tag &&
        a.canvasPath === (b as { canvasPath?: string | null }).canvasPath)

  /** Longest back/forward history kept; older steps fall off the front. */
  const HISTORY_MAX = 200
  /** Push a step (note or view) onto the history, truncating any forward entries. */
  const pushHistory = (entry: HistEntry): void => {
    const { history, histIndex } = get()
    const trimmed = history.slice(0, histIndex + 1)
    if (sameEntry(trimmed[trimmed.length - 1], entry)) return
    const next = [...trimmed, entry].slice(-HISTORY_MAX)
    set({ history: next, histIndex: next.length - 1 })
  }
  const recordHistory = (path: string): void => pushHistory({ kind: 'note', path })

  /** Apply a history step to the view state (no new history record). */
  const restoreEntry = (entry: HistEntry): void => {
    if (get().dirty) void flushAll()
    if (entry.kind === 'note') {
      set({ activePath: entry.path, view: 'editor' })
    } else {
      set({
        view: entry.view,
        ...(entry.view === 'database' && entry.baseId ? { activeBaseId: entry.baseId } : {}),
        ...(entry.view === 'tags' ? { activeTag: entry.tag ?? null } : {}),
        ...(entry.view === 'canvas' && entry.canvasPath ? { activeCanvasPath: entry.canvasPath } : {})
      })
    }
  }

  return {
    workspace: null,
    recentVaults: [],
    files: [],
    texts: {},
    parsed: {},
    index: new VaultIndex([], {}),
    history: [],
    histIndex: -1,
    sidePanes: [],
    activePath: null,
    view: 'editor',
    findRequest: null,
    bases: [],
    activeBaseId: null,
    canvases: [],
    activeCanvasPath: null,
    activeTag: null,
    modal: null,
    paletteOpen: false,
    sidebarOpen: localStorage.getItem('verso-sidebar') !== 'closed',
    rightbarOpen: localStorage.getItem('verso-rightbar') !== 'closed',
    theme: (localStorage.getItem('verso-theme') as 'light' | 'dark' | null) ?? 'dark',
    accent: localStorage.getItem('verso-accent') ?? 'indigo',
    customCss: null,
    editorFont: localStorage.getItem('verso-font') ?? 'sans',
    editorFontSize: Number(localStorage.getItem('verso-fontsize')) || 16,
    smartLinkTitles: localStorage.getItem('verso-smart-titles') !== 'off',
    dirty: false,
    loading: false,
    saveError: null,

    toggleTheme: () => {
      const theme = get().theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('verso-theme', theme)
      set({ theme })
    },

    setAccent: (accent) => {
      localStorage.setItem('verso-accent', accent)
      set({ accent })
    },

    reloadCustomCss: async () => {
      set({ customCss: await window.verso.readCustomCss() })
    },

    dismissSaveError: () => set({ saveError: null }),

    toggleSidebar: () => {
      const sidebarOpen = !get().sidebarOpen
      localStorage.setItem('verso-sidebar', sidebarOpen ? 'open' : 'closed')
      set({ sidebarOpen })
    },

    toggleRightbar: () => {
      const rightbarOpen = !get().rightbarOpen
      localStorage.setItem('verso-rightbar', rightbarOpen ? 'open' : 'closed')
      set({ rightbarOpen })
    },

    setEditorFont: (editorFont) => {
      localStorage.setItem('verso-font', editorFont)
      set({ editorFont })
    },

    setEditorFontSize: (editorFontSize) => {
      localStorage.setItem('verso-fontsize', String(editorFontSize))
      set({ editorFontSize })
    },

    setSmartLinkTitles: (smartLinkTitles) => {
      localStorage.setItem('verso-smart-titles', smartLinkTitles ? 'on' : 'off')
      set({ smartLinkTitles })
    },

    openModal: (modal) => set({ modal }),
    closeModal: () => set({ modal: null }),
    setPalette: (paletteOpen) => set({ paletteOpen }),

    openTag: (activeTag) => {
      if (get().dirty) void get().saveActive()
      set({ view: 'tags', activeTag })
      pushHistory({ kind: 'view', view: 'tags', tag: activeTag })
    },

    newFromTemplate: async (templatePath, folder = '') => {
      const tpl = (await window.verso.readNote(templatePath))?.text ?? ''
      const taken = new Set(get().files.map((f) => f.path.toLowerCase()))
      const prefix = folder ? `${folder}/` : ''
      let path = `${prefix}Untitled.md`
      let i = 1
      while (taken.has(path.toLowerCase())) path = `${prefix}Untitled ${i++}.md`
      const text = applyTemplate(tpl, basename(path), new Date())
      const created = await window.verso.createNote(path, text)
      if (created) {
        await get().applyFileEvent({ type: 'add', file: created })
        get().openNote(created.path)
      }
    },

    applySupertag: async (notePath, tag) => {
      const index = buildSupertagIndex(supertagsFromParsed(get().parsed))
      const st = index.get(normTag(tag))
      const display = st?.name ?? tag.replace(/^#/, '').trim()
      const data = { ...getFrontmatter(get().texts[notePath] ?? '') }
      const existing = Array.isArray(data.tags)
        ? data.tags.map(String)
        : typeof data.tags === 'string'
          ? data.tags.split(/[,\s]+/).filter(Boolean)
          : []
      if (existing.some((t) => normTag(t) === normTag(display))) return // already an instance
      data.tags = [...existing, display]
      await get().setNoteProperties(notePath, data)
    },

    ensureEntity: async (name, tag) => {
      const existing = resolveTarget(
        name,
        get().files.map((f) => f.path)
      )
      let path = existing
      if (!path) {
        const created = await window.verso.createNote(pathForNewNote(name), '')
        if (!created) return name
        await get().applyFileEvent({ type: 'add', file: created })
        path = created.path
      }
      await get().applySupertag(path, tag)
      return path
    },

    createSupertag: async (name, opts) => {
      const open = opts?.open !== false
      const clean = name.replace(/^#/, '').trim().replace(/[/\\]/g, '-')
      if (!clean) return
      const path = `${TAGS_DIR}/${clean}.md`
      if (get().files.some((f) => f.path.toLowerCase() === path.toLowerCase())) {
        if (open) get().openNote(path)
        return
      }
      const created = await window.verso.createNote(path, '---\nfields: {}\n---\n')
      if (created) {
        await get().applyFileEvent({ type: 'add', file: created })
        if (open) get().openNote(created.path)
      }
    },

    setSupertagFields: async (defPath, fields) => {
      const data = { ...getFrontmatter(get().texts[defPath] ?? '') }
      data.fields = fieldsToFrontmatter(fields)
      await get().setNoteProperties(defPath, data)
    },

    applySupertagToFolder: async (folder, tag) => {
      const notes = get().files.filter((f) => f.path.startsWith(folder + '/') && !f.path.startsWith(TAGS_DIR + '/'))
      // Sequential: each applySupertag writes through immediately, so avoid racing the files.
      for (const f of notes) await get().applySupertag(f.path, tag)
    },

    createSupertagFromFolder: async (folder) => {
      const name = folder.split('/').pop() || folder
      const tagPath = `${TAGS_DIR}/${name}.md`
      const notes = get().files.filter((f) => f.path.startsWith(folder + '/'))

      // Infer a field schema from the union of the folder notes' frontmatter keys.
      const inferType = (v: unknown): FieldDef['type'] => {
        if (typeof v === 'boolean') return 'checkbox'
        if (typeof v === 'number') return 'number'
        if (Array.isArray(v)) return 'list'
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) return 'url'
        return 'text'
      }
      const fieldMap = new Map<string, FieldDef>()
      for (const f of notes) {
        const fm = getFrontmatter(get().texts[f.path] ?? '')
        for (const [k, v] of Object.entries(fm)) {
          if (k.startsWith('_') || k === 'tags' || k === 'pinned' || fieldMap.has(k)) continue
          if (v === undefined || v === null || v === '') continue
          fieldMap.set(k, { name: k, type: inferType(v) })
        }
      }
      const fields = [...fieldMap.values()]

      // Create the supertag definition (or update an existing one with the inferred fields).
      const existing = get().files.find((x) => x.path.toLowerCase() === tagPath.toLowerCase())
      let defPath = tagPath
      if (existing) {
        defPath = existing.path
        await get().setSupertagFields(defPath, fields)
      } else {
        const text = replaceFrontmatter(`# ${name}\n`, { fields: fieldsToFrontmatter(fields) })
        const created = await window.verso.createNote(tagPath, text)
        if (!created) return
        await get().applyFileEvent({ type: 'add', file: created })
      }

      for (const f of notes) await get().applySupertag(f.path, name)
      get().openNote(defPath)
    },

    applyTemplateToNote: async (notePath, templatePath) => {
      const raw = (await window.verso.readNote(templatePath))?.text ?? ''
      const noteName = get().files.find((f) => f.path === notePath)?.name ?? basename(notePath)
      const tpl = parseFrontmatter(applyTemplate(raw, noteName, new Date()))
      const cur = parseFrontmatter(get().texts[notePath] ?? '')
      // Template properties fill in; the note's own existing values win.
      const mergedFm = { ...tpl.data, ...cur.data }
      const combinedBody = [cur.body.trimEnd(), tpl.body.trim()].filter(Boolean).join('\n\n')
      const text = replaceFrontmatter(combinedBody, mergedFm)
      updateNoteState(notePath, text)
      pending.delete(notePath)
      await queueWrite(notePath, text)
    },

    reorderTo: async (dragPath, dropPath) => {
      const folder = dirname(dropPath)
      if (dirname(dragPath) !== folder) return get().moveToFolder(dragPath, folder)
      const siblings = siblingPaths(folder).filter((p) => p !== dragPath)
      const at = siblings.indexOf(dropPath)
      if (at < 0) return
      siblings.splice(at, 0, dragPath)
      await persistOrder(siblings)
    },

    moveToFolder: async (path, folder) => {
      const name = basename(path)
      const target = folder ? `${folder}/${name}` : name
      await get().renameNote(path, target)
    },

    setBases: (bases) => {
      void window.verso.writeBases(bases)
      const activeBaseId = bases.some((b) => b.id === get().activeBaseId)
        ? get().activeBaseId
        : (bases[0]?.id ?? null)
      set({ bases, activeBaseId })
    },

    openBase: (id) => {
      if (get().dirty) void get().saveActive()
      set({ view: 'database', activeBaseId: id })
      pushHistory({ kind: 'view', view: 'database', baseId: id })
    },

    refreshCanvases: async () => {
      const canvases = await window.verso.listCanvases()
      const active = get().activeCanvasPath
      set({
        canvases,
        activeCanvasPath: active && canvases.some((c) => c.path === active) ? active : (canvases[0]?.path ?? null)
      })
    },

    openCanvasView: () => {
      if (get().dirty) void get().saveActive()
      const path = get().activeCanvasPath
      set({ view: 'canvas' })
      pushHistory({ kind: 'view', view: 'canvas', canvasPath: path })
    },

    openCanvas: (path) => {
      if (get().dirty) void get().saveActive()
      set({ view: 'canvas', activeCanvasPath: path })
      pushHistory({ kind: 'view', view: 'canvas', canvasPath: path })
    },

    createCanvas: async (name, folder = '') => {
      const clean = name.trim().replace(/\.canvas$/i, '') || 'Canvas'
      const taken = new Set(get().canvases.map((c) => c.path.toLowerCase()))
      const prefix = folder ? `${folder}/` : ''
      let path = `${prefix}${clean}.canvas`
      let i = 1
      while (taken.has(path.toLowerCase())) path = `${prefix}${clean} ${i++}.canvas`
      const created = await window.verso.createCanvas(path)
      if (!created) return
      set({ canvases: [created, ...get().canvases], activeCanvasPath: created.path, view: 'canvas' })
      pushHistory({ kind: 'view', view: 'canvas', canvasPath: created.path })
    },

    deleteCanvas: async (path) => {
      const ok = await window.verso.deleteCanvas(path)
      if (!ok) return
      const canvases = get().canvases.filter((c) => c.path !== path)
      const activeCanvasPath = get().activeCanvasPath === path ? (canvases[0]?.path ?? null) : get().activeCanvasPath
      set({ canvases, activeCanvasPath })
    },

    renameCanvas: async (path, name) => {
      const trimmed = name.trim().replace(/\.canvas$/i, '')
      if (!trimmed) return
      const dir = dirname(path)
      const newPath = trimmed.includes('/') ? `${trimmed}.canvas` : dir ? `${dir}/${trimmed}.canvas` : `${trimmed}.canvas`
      if (newPath === path) return
      const meta = await window.verso.renameCanvas(path, newPath)
      if (!meta) return
      set({
        canvases: get().canvases.map((c) => (c.path === path ? meta : c)),
        activeCanvasPath: get().activeCanvasPath === path ? meta.path : get().activeCanvasPath
      })
    },

    bootstrap: async () => {
      set({ recentVaults: await window.verso.getWorkspaces() })
      const last = await window.verso.getLastWorkspace()
      if (!last) return
      set({ loading: true })
      const ws = await window.verso.loadWorkspace(last)
      if (!ws) return set({ loading: false })
      await applyWorkspace(ws)
    },

    openWorkspace: async () => {
      set({ loading: true })
      const ws = await window.verso.openWorkspace()
      if (!ws) return set({ loading: false })
      await applyWorkspace(ws)
      set({ recentVaults: await window.verso.getWorkspaces() })
    },

    switchVault: async (root) => {
      if (get().workspace?.root === root) return
      if (get().dirty) await flushAll() // don't lose unsaved edits on swap
      set({ loading: true })
      const ws = await window.verso.loadWorkspace(root)
      if (!ws) return set({ loading: false })
      await applyWorkspace(ws)
      set({ recentVaults: await window.verso.getWorkspaces() })
    },

    forgetVault: async (root) => {
      const remaining = await window.verso.forgetWorkspace(root)
      set({ recentVaults: remaining })
    },

    reloadVault: async () => {
      const ws = get().workspace
      if (!ws) return
      const fresh = await window.verso.loadWorkspace(ws.root)
      if (!fresh) return
      const { texts, parsed } = await loadAll()
      const exists = (p: string | null | undefined): boolean => !!p && fresh.files.some((f) => f.path === p)
      const active = get().activePath
      set({
        workspace: fresh,
        files: fresh.files,
        texts,
        parsed,
        index: buildIndex(parsed, texts),
        activePath: exists(active) ? active : (fresh.files[0]?.path ?? null),
        sidePanes: get().sidePanes.filter((sp) => sp.kind === 'pdf' || exists(sp.path))
      })
    },

    openNote: (path) => {
      activateNote(path)
      recordHistory(path)
    },

    openNoteWithFind: (path, query) => {
      activateNote(path)
      recordHistory(path)
      set({ findRequest: { path, query } })
    },

    clearFindRequest: () => set({ findRequest: null }),

    openInSidePane: (path) => {
      const panes = get().sidePanes
      if (panes.some((p) => p.kind === 'note' && p.path === path)) return // already open in a split
      set({ sidePanes: [...panes, { kind: 'note', path }] })
    },

    goBack: () => {
      const { history, histIndex } = get()
      if (histIndex <= 0) return
      const i = histIndex - 1
      set({ histIndex: i })
      restoreEntry(history[i])
    },

    goForward: () => {
      const { history, histIndex } = get()
      if (histIndex >= history.length - 1) return
      const i = histIndex + 1
      set({ histIndex: i })
      restoreEntry(history[i])
    },

    openView: (view) => {
      if (get().dirty) void get().saveActive()
      set({ view })
      if (view !== 'editor') pushHistory({ kind: 'view', view })
    },

    openPdf: (path, highlightId) => {
      const panes = get().sidePanes
      const already = panes.some((p) => p.kind === 'pdf' && p.path === path)
      if (!already) set({ sidePanes: [...panes, { kind: 'pdf', path }] })
      if (highlightId) setTimeout(() => pdfBus.goto(highlightId), already ? 50 : 600)
    },

    closeSidePane: (index) => {
      const panes = get().sidePanes
      if (!panes.length) return
      const at = index ?? panes.length - 1
      set({ sidePanes: panes.filter((_, i) => i !== at) })
    },

    editNote: (path, text) => {
      updateText(path, text)
      pending.set(path, text)
      set({ dirty: true })
      scheduleFlush()
    },

    setNoteBody: (path, body) => {
      const raw = parseFrontmatter(get().texts[path] ?? '').raw
      get().editNote(path, raw ? `${raw}\n${body}` : body)
    },

    editActive: (text) => {
      const path = get().activePath
      if (path) get().editNote(path, text)
    },

    saveActive: () => flushAll(),

    setNoteProperties: async (path, data) => {
      const cur = get().texts[path] ?? ''
      const text = replaceFrontmatter(cur, data)
      updateNoteState(path, text)
      pending.delete(path)
      await queueWrite(path, text)
    },

    setTableWidths: async (path, index, widths) => {
      const data = { ...getFrontmatter(get().texts[path] ?? '') }
      const tw = { ...((data._tableWidths as Record<string, number[]>) ?? {}) }
      tw[index] = widths
      data._tableWidths = tw
      await get().setNoteProperties(path, data)
    },

    togglePin: async (path) => {
      const data = { ...getFrontmatter(get().texts[path] ?? '') }
      if (data.pinned) delete data.pinned
      else data.pinned = true
      await get().setNoteProperties(path, data)
    },

    linkUnlinked: async (sourcePath, line, name) => {
      const text = get().texts[sourcePath]
      if (text === undefined) return
      const lines = text.split('\n')
      if (line < 0 || line >= lines.length) return
      const next = wrapMention(lines[line], name)
      if (next === lines[line]) return
      lines[line] = next
      get().editNote(sourcePath, lines.join('\n'))
    },

    linkAllUnlinked: async (path) => {
      const refs = get().index.unlinkedReferences(path)
      if (!refs.length) return
      const name = refs[0].ref.raw
      const bySource = new Map<string, number[]>()
      for (const r of refs) bySource.set(r.sourcePath, [...(bySource.get(r.sourcePath) ?? []), r.line])
      for (const [sp, lineNums] of bySource) {
        const text = get().texts[sp]
        if (text === undefined) continue
        const lines = text.split('\n')
        let changed = false
        for (const ln of lineNums) {
          if (ln < 0 || ln >= lines.length) continue
          const next = wrapMention(lines[ln], name)
          if (next !== lines[ln]) {
            lines[ln] = next
            changed = true
          }
        }
        if (changed) get().editNote(sp, lines.join('\n'))
      }
    },

    toggleTask: async (path, line) => {
      const cur = get().texts[path]
      if (cur === undefined) return
      const lines = cur.split('\n')
      const m = lines[line]?.match(/^(\s*- \[)([ xX])(\].*)$/)
      if (!m) return
      lines[line] = m[1] + (m[2].toLowerCase() === 'x' ? ' ' : 'x') + m[3]
      const text = lines.join('\n')
      // Write straight through (not the debounced editor buffer) so a checkbox toggle
      // survives an immediate app close.
      updateNoteState(path, text)
      pending.delete(path)
      await queueWrite(path, text)
    },

    navigate: async (raw, side = false) => {
      // Real filenames first (immediate); then frontmatter aliases via the index.
      const existing =
        resolveTarget(
          raw,
          get().files.map((f) => f.path)
        ) ?? get().index.resolvePath(raw)
      if (existing) {
        side ? get().openInSidePane(existing) : get().openNote(existing)
        return
      }
      const path = pathForNewNote(raw)
      // Start with an empty body — the title comes from the filename (shown at the top),
      // so the note opens as a blank paragraph ready for typing.
      const created = await window.verso.createNote(path, '')
      if (created) {
        await get().applyFileEvent({ type: 'add', file: created })
        side ? get().openInSidePane(created.path) : get().openNote(created.path)
      }
    },

    ensureDailyNote: async (iso) => {
      const path = dailyPath(iso)
      const exists = get().files.some((f) => f.path === path)
      const empty = !(get().texts[path] ?? '').trim()
      // Seed from `Templates/Journal.md` when the day is brand-new or still blank.
      if (!exists || empty) {
        // Match a `Templates/` note named "Journal" or "Journal Template".
        const tpl = get().files.find(
          (f) => f.path.startsWith('Templates/') && /^journal( template)?$/i.test(f.name)
        )
        const seed = tpl
          ? applyTemplate((await window.verso.readNote(tpl.path))?.text ?? '', basename(path), new Date())
          : ''
        if (!exists) {
          const created = await window.verso.createNote(path, seed)
          if (created) await get().applyFileEvent({ type: 'add', file: created })
        } else if (seed) {
          get().editNote(path, seed)
        }
      }
      return path
    },

    applyFileEvent: async (event) => {
      const evPath = event.type === 'unlink' ? event.path : event.type === 'rename' ? event.path : event.file.path
      // Non-markdown vault files route to their own reloaders (the watcher forwards
      // canvas / bases / custom-css / asset events too, not just notes).
      if (evPath === '.verso/custom.css') {
        await get().reloadCustomCss()
        return
      }
      if (evPath === '.verso/bases.json') {
        const bases = normalizeBases(await window.verso.readBases())
        const activeBaseId = bases.some((b) => b.id === get().activeBaseId)
          ? get().activeBaseId
          : (bases[0]?.id ?? null)
        set({ bases, activeBaseId })
        return
      }
      if (evPath.toLowerCase().endsWith('.canvas')) {
        await get().refreshCanvases()
        return
      }
      if (!evPath.toLowerCase().endsWith('.md')) return // asset events don't affect note state

      if (event.type === 'unlink') {
        dropFromScanCache(event.path)
        // Merge onto the latest state (a functional update) so concurrent events
        // can't clobber each other.
        set((state) => {
          const files = state.files.filter((f) => f.path !== event.path)
          const texts = { ...state.texts }
          const parsed = { ...state.parsed }
          delete texts[event.path]
          delete parsed[event.path]
          return {
            files,
            texts,
            parsed,
            index: buildIndex(parsed, texts),
            activePath: state.activePath === event.path ? (files[0]?.path ?? null) : state.activePath,
            sidePanes: state.sidePanes.filter((sp) => sp.path !== event.path)
          }
        })
        return
      }

      // An external move: swap the old path for the new one, keeping identity (the
      // open note / splits follow the file instead of resetting).
      if (event.type === 'rename') {
        dropFromScanCache(event.oldPath)
        const content = await window.verso.readNote(event.path)
        set((state) => {
          const texts = { ...state.texts }
          const parsed = { ...state.parsed }
          delete texts[event.oldPath]
          delete parsed[event.oldPath]
          let files = state.files.filter((f) => f.path !== event.oldPath)
          if (content !== null) {
            texts[event.path] = content.text
            parsed[event.path] = parseNote(event.path, content.text)
            const meta = event.file ?? { path: event.path, name: basename(event.path), mtime: 0 }
            files = [...files.filter((f) => f.path !== event.path), meta]
          }
          const moved = content !== null
          return {
            files,
            texts,
            parsed,
            index: buildIndex(parsed, texts),
            activePath:
              state.activePath === event.oldPath
                ? moved
                  ? event.path
                  : (files[0]?.path ?? null)
                : state.activePath,
            sidePanes: moved
              ? state.sidePanes.map((sp) => (sp.path === event.oldPath ? { ...sp, path: event.path } : sp))
              : state.sidePanes.filter((sp) => sp.path !== event.oldPath)
          }
        })
        return
      }

      const { file } = event
      // Don't stomp a buffer with unsaved edits.
      if (event.type === 'change' && isPending(file.path)) return
      // Read first (this awaits), THEN merge onto the freshest state — otherwise
      // a burst of adds would each start from the same stale snapshot and overwrite
      // one another, so only the last few would survive.
      const content = await window.verso.readNote(file.path)
      if (content === null) return
      set((state) => {
        const texts = { ...state.texts, [file.path]: content.text }
        const note = parseNote(file.path, content.text)
        const parsed = { ...state.parsed, [file.path]: note }
        const known = state.files.some((f) => f.path === file.path)
        const files = known
          ? state.files.map((f) => (f.path === file.path ? file : f))
          : [...state.files, file]
        // A change to an existing note patches the index in O(1 note); a brand-new
        // file (or an alias shift, which withContentChanges rejects) rebuilds fully.
        const incremental =
          event.type === 'change' && known ? state.index.withContentChanges([note], texts) : null
        return { files, texts, parsed, index: incremental ?? buildIndex(parsed, texts) }
      })
    },

    renameNote: async (oldPath, input) => {
      const trimmed = input.trim().replace(/\.md$/i, '')
      if (!trimmed) return
      const dir = dirname(oldPath)
      const newPath = trimmed.includes('/') ? `${trimmed}.md` : dir ? `${dir}/${trimmed}.md` : `${trimmed}.md`
      if (newPath === oldPath) return

      const state = get()
      if (isPending(oldPath)) await flushAll()
      const created = await window.verso.renameNote(oldPath, newPath)
      if (!created) return
      dropFromScanCache(oldPath)

      try {
        const oldAllPaths = state.files.map((f) => f.path)
        // The renamed note's own body may link to itself by its old name — rewrite it too.
        const own = state.texts[oldPath] ?? ''
        const ownRewritten = rewriteLinks(own, oldPath, newPath, oldAllPaths)
        const texts: Record<string, string> = { [newPath]: ownRewritten }
        if (ownRewritten !== own) await queueWrite(newPath, ownRewritten)
        for (const [p, t] of Object.entries(state.texts)) {
          if (p === oldPath) continue
          const rewritten = rewriteLinks(t, oldPath, newPath, oldAllPaths)
          texts[p] = rewritten
          if (rewritten !== t) await queueWrite(p, rewritten)
        }
        const parsed: Record<string, ParsedNote> = {}
        for (const [p, t] of Object.entries(texts)) parsed[p] = parseNote(p, t)
        const files = state.files.filter((f) => f.path !== oldPath).concat(created)
        set({
          texts,
          parsed,
          files,
          index: buildIndex(parsed, texts),
          activePath: state.activePath === oldPath ? newPath : state.activePath,
          sidePanes: state.sidePanes.map((sp) => (sp.path === oldPath ? { ...sp, path: newPath } : sp))
        })
        // Canvas cards point at notes by path — retarget any that referenced the old path.
        for (const c of get().canvases) {
          const doc = normalizeDoc(await window.verso.readCanvas(c.path))
          let changed = false
          const nodes = doc.nodes.map((n) => {
            if (n.type === 'file' && n.file === oldPath) {
              changed = true
              return { ...n, file: newPath }
            }
            return n
          })
          if (changed) await window.verso.writeCanvas(c.path, { ...doc, nodes })
        }
      } catch (e) {
        // The file moved but a referrer-rewrite failed partway through, so memory and
        // disk may now disagree. Re-scan from disk to reconcile to a consistent state.
        console.error('renameNote: link rewrite failed, reloading vault', e)
        await get().reloadVault()
      }
    },

    reorderNote: async (path, dir) => {
      const siblings = siblingPaths(dirname(path))
      const i = siblings.indexOf(path)
      const j = i + dir
      if (i < 0 || j < 0 || j >= siblings.length) return
      ;[siblings[i], siblings[j]] = [siblings[j], siblings[i]]
      await persistOrder(siblings)
    },

    deleteNote: async (path) => {
      const ok = await window.verso.deleteNote(path)
      if (!ok) return
      await get().applyFileEvent({ type: 'unlink', path })
    },

    duplicateNote: async (path) => {
      const text = get().texts[path] ?? (await window.verso.readNote(path))?.text ?? ''
      const base = path.replace(/\.md$/i, '')
      const taken = new Set(get().files.map((f) => f.path.toLowerCase()))
      let np = `${base} copy.md`
      let i = 2
      while (taken.has(np.toLowerCase())) np = `${base} copy ${i++}.md`
      const created = await window.verso.createNote(np, text)
      if (created) {
        await get().applyFileEvent({ type: 'add', file: created })
        get().openNote(created.path)
      }
    },

    revealNote: async (path) => {
      await window.verso.revealNote(path)
    }
  }
})
