import { create } from 'zustand'
import type { NoteFile } from '@shared/types'
import { makeVaultFS, isNative, normalizeRoot, type VaultFS } from './fs'
import { dailyPath, todayISO } from '@vlib/dates'

/** Default vault location on the phone — a folder your sync tool fills. */
export const DEFAULT_ROOT = '/storage/emulated/0/Verso'

interface MobileState {
  fs: VaultFS | null
  root: string
  files: NoteFile[]
  /** Note texts, loaded lazily per note. */
  texts: Record<string, string>
  /** Navigation stack of note paths; empty = the list screen. */
  stack: string[]
  editing: boolean
  error: string | null

  openVault: (root: string) => Promise<void>
  refresh: () => Promise<void>
  openNote: (path: string) => Promise<void>
  back: () => void
  setEditing: (on: boolean) => void
  saveNote: (path: string, text: string) => Promise<void>
  /** Append a timestamped bullet to today's journal note. */
  captureToJournal: (text: string) => Promise<void>
}

export const useApp = create<MobileState>((set, get) => ({
  fs: null,
  root: localStorage.getItem('verso-mobile-root') ?? DEFAULT_ROOT,
  files: [],
  texts: {},
  stack: [],
  editing: false,
  error: null,

  openVault: async (raw) => {
    const root = normalizeRoot(raw)
    const fs = makeVaultFS(root)
    try {
      const files = await fs.list()
      localStorage.setItem('verso-mobile-root', root)
      set({ fs, root, files, error: null })
    } catch (e) {
      set({ error: `Could not read ${root} — check the path and storage permission. (${String(e)})` })
    }
  },

  refresh: async () => {
    const { fs } = get()
    if (!fs) return
    try {
      set({ files: await fs.list() })
    } catch {
      /* keep the stale list — better than wiping the screen on a hiccup */
    }
  },

  openNote: async (path) => {
    const { fs } = get()
    if (!fs) return
    try {
      const text = await fs.read(path)
      set((s) => ({ texts: { ...s.texts, [path]: text }, stack: [...s.stack, path], editing: false }))
    } catch (e) {
      set({ error: `Could not open ${path}: ${String(e)}` })
    }
  },

  back: () => set((s) => ({ stack: s.stack.slice(0, -1), editing: false, error: null })),
  setEditing: (editing) => set({ editing }),

  saveNote: async (path, text) => {
    const { fs } = get()
    if (!fs) return
    set((s) => ({ texts: { ...s.texts, [path]: text } }))
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
      set((s) => ({ texts: { ...s.texts, [path]: next } }))
      await get().refresh()
    } catch (e) {
      set({ error: `Capture failed: ${String(e)}` })
    }
  }
}))

export { isNative }
