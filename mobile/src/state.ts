import { create } from 'zustand'
import type { NoteFile, ParsedNote } from '@shared/types'
import { makeVaultFS, isNative, normalizeRoot, type VaultFS } from './fs'
import { dailyPath, todayISO } from '@vlib/dates'
import { parseNote } from '@vlib/parse'
import { normalizeBases, type Base } from '@vlib/bases'

/** Default vault location on the phone — a folder your sync tool fills. */
export const DEFAULT_ROOT = '/storage/emulated/0/Verso'

/** Which main screen is showing (the nav stack overlays notes on top). */
export type View = 'notes' | 'todos' | 'base'

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

/** Read every note once so Bases/Todos see the whole vault (background). */
async function scanAll(fs: VaultFS, files: NoteFile[]): Promise<{ texts: Record<string, string>; parsed: Record<string, ParsedNote> }> {
  const texts: Record<string, string> = {}
  const parsed: Record<string, ParsedNote> = {}
  for (const f of files) {
    try {
      const t = await fs.read(f.path)
      texts[f.path] = t
      parsed[f.path] = parseNote(f.path, t)
    } catch {
      /* unreadable note — skip it */
    }
  }
  return { texts, parsed }
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
      set({ fs, root, files, error: null, scanning: true })
      // Background: bases + a full text scan (Bases/Todos need frontmatter/tasks).
      void loadBases(fs).then((bases) => set({ bases }))
      void scanAll(fs, files).then(({ texts, parsed }) =>
        set((s) => ({ texts: { ...texts, ...s.texts }, parsed, scanning: false }))
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
      set({ files, scanning: true })
      void loadBases(fs).then((bases) => set({ bases }))
      const { texts, parsed } = await scanAll(fs, files)
      set({ texts, parsed, scanning: false })
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
