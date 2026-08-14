import { create } from 'zustand'
import type { NoteFile, ParsedNote } from '@shared/types'
import { makeVaultFS, isNative, normalizeRoot, type VaultFS } from './fs'
import { dailyPath, todayISO } from '@vlib/dates'
import { parseNote } from '@vlib/parse'
import { normalizeBases, type Base } from '@vlib/bases'
import { VaultIndex } from '@vlib/vault'

/**
 * The vault index, built on demand and memoised on the identity of the maps it
 * derives from. Mobile doesn't keep one in state (nothing here needs backlinks
 * or a graph) — search is the one caller, and rebuilding per keystroke would be
 * wasteful where rebuilding per scan is nothing.
 */
let indexCache: { parsed: unknown; texts: unknown; index: VaultIndex } | null = null
export function vaultIndex(parsed: Record<string, ParsedNote>, texts: Record<string, string>): VaultIndex {
  if (indexCache && indexCache.parsed === parsed && indexCache.texts === texts) return indexCache.index
  const index = new VaultIndex(Object.values(parsed), texts)
  indexCache = { parsed, texts, index }
  return index
}

/** Default vault location on the phone — a folder your sync tool fills. */
export const DEFAULT_ROOT = '/storage/emulated/0/Verso'

/** Which main screen is showing (the nav stack overlays notes on top). */
export type View = 'notes' | 'todos' | 'base' | 'journal'

interface MobileState {
  fs: VaultFS | null
  root: string
  files: NoteFile[]
  /** Note texts — filled by the background scan, kept current by edits. */
  texts: Record<string, string>
  /** Parsed notes (frontmatter/tags/links), for Bases and Todos. */
  parsed: Record<string, ParsedNote>
  /** True while the background full-vault scan is running. */
  scanning: boolean
  /** Notes read so far / total, so every screen built from the whole vault can
   *  say it isn't complete yet rather than quietly showing too little. */
  scanned: number
  scanTotal: number
  /** mtime each note's text was read at — what makes a rescan incremental. */
  mtimes: Record<string, number>
  bases: Base[]
  view: View
  activeBaseId: string | null
  drawerOpen: boolean
  /** Navigation stack of note paths; empty = the current view's screen. */
  stack: string[]
  editing: boolean
  error: string | null

  openVault: (root: string) => Promise<void>
  refresh: () => Promise<void>
  openNote: (path: string) => Promise<void>
  openView: (view: View, baseId?: string) => void
  openJournal: () => Promise<void>
  setDrawer: (open: boolean) => void
  back: () => void
  setEditing: (on: boolean) => void
  saveNote: (path: string, text: string) => Promise<void>
  /** Append a timestamped bullet to today's journal note. */
  captureToJournal: (text: string) => Promise<void>
}

/**
 * Read the vault so Bases/Todos/search see all of it.
 *
 * Every read is a bridge call to native, so on a phone the READS are the cost —
 * not the parsing. `prev` carries what we already hold, keyed by the mtime it was
 * read at: a file whose mtime is unchanged is neither re-read nor re-parsed. A
 * refresh after editing one note therefore costs one read, not the whole vault.
 * (This is the mobile counterpart of the desktop's persistent parse cache; the
 * desktop caches the PARSE because its reads are cheap, and here it's reversed.)
 */
interface Scanned {
  texts: Record<string, string>
  parsed: Record<string, ParsedNote>
  mtimes: Record<string, number>
}

async function scanAll(
  fs: VaultFS,
  files: NoteFile[],
  prev: Scanned,
  onProgress?: (done: number, total: number) => void
): Promise<Scanned> {
  const texts: Record<string, string> = {}
  const parsed: Record<string, ParsedNote> = {}
  const mtimes: Record<string, number> = {}
  let done = 0
  for (const f of files) {
    const fresh = prev.mtimes[f.path] === f.mtime && prev.texts[f.path] !== undefined
    if (fresh) {
      texts[f.path] = prev.texts[f.path]
      parsed[f.path] = prev.parsed[f.path] ?? parseNote(f.path, prev.texts[f.path])
      mtimes[f.path] = f.mtime
    } else {
      try {
        const t = await fs.read(f.path)
        texts[f.path] = t
        parsed[f.path] = parseNote(f.path, t)
        mtimes[f.path] = f.mtime
      } catch {
        /* unreadable note — skip it */
      }
    }
    onProgress?.(++done, files.length)
  }
  return { texts, parsed, mtimes }
}

async function loadBases(fs: VaultFS): Promise<Base[]> {
  try {
    return normalizeBases(JSON.parse(await fs.read('.verso/bases.json')))
  } catch {
    return []
  }
}

export const useApp = create<MobileState>((set, get) => ({
  fs: null,
  root: localStorage.getItem('verso-mobile-root') ?? DEFAULT_ROOT,
  files: [],
  texts: {},
  parsed: {},
  scanning: false,
  scanned: 0,
  scanTotal: 0,
  mtimes: {},
  bases: [],
  view: 'notes',
  activeBaseId: null,
  drawerOpen: false,
  stack: [],
  editing: false,
  error: null,

  openVault: async (raw) => {
    const root = normalizeRoot(raw)
    const fs = makeVaultFS(root)
    try {
      const files = await fs.list()
      localStorage.setItem('verso-mobile-root', root)
      set({ fs, root, files, error: null, scanning: true, scanned: 0, scanTotal: files.length, mtimes: {} })
      // Background: bases + a full text scan (Bases/Todos need frontmatter/tasks).
      void loadBases(fs).then((bases) => set({ bases }))
      void scanAll(fs, files, { texts: {}, parsed: {}, mtimes: {} }, (done, total) =>
        set({ scanned: done, scanTotal: total })
      ).then(({ texts, parsed, mtimes }) =>
        // A note opened (or edited) DURING the scan wins: its text is newer than
        // whatever the scan read for it.
        set((s) => ({ texts: { ...texts, ...s.texts }, parsed, mtimes, scanning: false }))
      )
    } catch (e) {
      set({ error: `Could not read ${root} — check the path and storage permission. (${String(e)})` })
    }
  },

  refresh: async () => {
    const { fs } = get()
    if (!fs) return
    try {
      const files = await fs.list()
      const prev = { texts: get().texts, parsed: get().parsed, mtimes: get().mtimes }
      set({ files, scanning: true, scanned: 0, scanTotal: files.length })
      void loadBases(fs).then((bases) => set({ bases }))
      const { texts, parsed, mtimes } = await scanAll(fs, files, prev, (done, total) =>
        set({ scanned: done, scanTotal: total })
      )
      set({ texts, parsed, mtimes, scanning: false })
    } catch {
      set({ scanning: false })
    }
  },

  openNote: async (path) => {
    const { fs } = get()
    if (!fs) return
    try {
      const text = await fs.read(path)
      set((s) => ({
        texts: { ...s.texts, [path]: text },
        parsed: { ...s.parsed, [path]: parseNote(path, text) },
        stack: [...s.stack, path],
        editing: false,
        drawerOpen: false
      }))
    } catch (e) {
      set({ error: `Could not open ${path}: ${String(e)}` })
    }
  },

  openView: (view, baseId) =>
    set({ view, activeBaseId: baseId ?? null, stack: [], editing: false, drawerOpen: false }),

  openJournal: async () => {
    const { fs } = get()
    if (!fs) return
    const path = dailyPath(todayISO())
    try {
      await fs.read(path)
    } catch {
      await fs.write(path, '')
      await get().refresh()
    }
    set({ drawerOpen: false })
    await get().openNote(path)
  },

  setDrawer: (drawerOpen) => set({ drawerOpen }),
  back: () => set((s) => ({ stack: s.stack.slice(0, -1), editing: false, error: null })),
  setEditing: (editing) => set({ editing }),

  saveNote: async (path, text) => {
    const { fs } = get()
    if (!fs) return
    set((s) => ({
      texts: { ...s.texts, [path]: text },
      parsed: { ...s.parsed, [path]: parseNote(path, text) }
    }))
    try {
      await fs.write(path, text)
    } catch (e) {
      set({ error: `Save failed: ${String(e)}` })
    }
  },

  captureToJournal: async (text) => {
    const { fs } = get()
    const clean = text.trim()
    if (!fs || !clean) return
    const path = dailyPath(todayISO())
    let cur = ''
    try {
      cur = await fs.read(path)
    } catch {
      /* new daily note */
    }
    const now = new Date()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const line = `- ${hm} ${clean}\n`
    const next = cur ? (cur.endsWith('\n') ? cur + line : cur + '\n' + line) : line
    try {
      await fs.write(path, next)
      set((s) => ({ texts: { ...s.texts, [path]: next }, parsed: { ...s.parsed, [path]: parseNote(path, next) } }))
      await get().refresh()
    } catch (e) {
      set({ error: `Capture failed: ${String(e)}` })
    }
  }
}))

export { isNative }
