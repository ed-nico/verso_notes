/**
 * Store integration tests: the per-path write queue (no lost updates when a
 * debounced flush races an immediate write) and the rename pipeline (link
 * rewriting in referrers and in the renamed note itself).
 *
 * The store touches `window.inkwell` and `localStorage` at module scope, so both
 * are stubbed BEFORE the store is imported (dynamic import in beforeAll).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { NoteFile, WriteResult } from '@shared/types'

type WriteLogEntry = { path: string; text: string; phase: 'start' | 'end' }

const writeLog: WriteLogEntry[] = []
let inFlight = 0
let maxInFlight = 0
let writeDelay = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const inkwell = {
  writeNote: vi.fn(async (path: string, text: string): Promise<WriteResult> => {
    writeLog.push({ path, text, phase: 'start' })
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    if (writeDelay) await sleep(writeDelay)
    inFlight--
    writeLog.push({ path, text, phase: 'end' })
    return { ok: true }
  }),
  renameNote: vi.fn(
    async (_oldPath: string, newPath: string): Promise<NoteFile> => ({
      path: newPath,
      name: newPath.replace(/\.md$/i, '').split('/').pop() ?? newPath,
      mtime: 1
    })
  ),
  readNote: vi.fn(async () => null),
  readCanvas: vi.fn(async (_path: string): Promise<unknown> => ({ nodes: [], edges: [] })),
  writeCanvas: vi.fn(async (_path: string, _data: unknown): Promise<WriteResult> => ({ ok: true })),
  readCustomCss: vi.fn(async () => null),
  readBases: vi.fn(async () => null),
  listCanvases: vi.fn(async () => [])
}

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k)
})
vi.stubGlobal('window', { inkwell })

// Imported dynamically so the stubs above are in place first.
let useStore: (typeof import('./store'))['useStore']
let parseNote: (typeof import('./lib/parse'))['parseNote']
let VaultIndex: (typeof import('./lib/vault'))['VaultIndex']

beforeAll(async () => {
  useStore = (await import('./store')).useStore
  parseNote = (await import('./lib/parse')).parseNote
  VaultIndex = (await import('./lib/vault')).VaultIndex
})

/** Seed the store with an in-memory vault. */
function seed(texts: Record<string, string>): void {
  const files: NoteFile[] = Object.keys(texts).map((path) => ({
    path,
    name: path.replace(/\.md$/i, '').split('/').pop() ?? path,
    mtime: 1
  }))
  const parsed = Object.fromEntries(Object.entries(texts).map(([p, t]) => [p, parseNote(p, t)]))
  useStore.setState({
    files,
    texts: { ...texts },
    parsed,
    index: new VaultIndex(Object.values(parsed), texts),
    canvases: [],
    sidePanes: [],
    activePath: files[0]?.path ?? null,
    history: [],
    histIndex: -1,
    dirty: false,
    saveError: null
  })
}

beforeEach(() => {
  writeLog.length = 0
  inFlight = 0
  maxInFlight = 0
  writeDelay = 0
  vi.clearAllMocks()
})

describe('per-path write queue', () => {
  it('serializes a debounced flush against an immediate property write', async () => {
    seed({ 'a.md': 'first' })
    writeDelay = 25 // make the buffered write slow enough to overlap
    const st = useStore.getState()

    st.editNote('a.md', 'edited body')
    const flush = st.saveActive() // starts the slow buffered write
    // Immediately race an immediate write to the same path (old code: could finish
    // first and be clobbered when the slow buffered write landed after it).
    const props = st.setNoteProperties('a.md', { pinned: true })
    await Promise.all([flush, props])

    const aWrites = writeLog.filter((w) => w.path === 'a.md')
    // Never two writes to the same path in flight at once…
    expect(maxInFlight).toBe(1)
    // …and the LAST write on disk is the newest content (with the property).
    const last = aWrites[aWrites.length - 1]
    expect(last.text).toContain('pinned: true')
    expect(last.text).toContain('edited body')
  })

  it('flushes different paths concurrently but each path in order', async () => {
    seed({ 'a.md': 'a', 'b.md': 'b' })
    const st = useStore.getState()
    st.editNote('a.md', 'a2')
    st.editNote('b.md', 'b2')
    await st.saveActive()
    const paths = writeLog.filter((w) => w.phase === 'end').map((w) => w.path)
    expect(paths.sort()).toEqual(['a.md', 'b.md'])
  })

  it('surfaces a failed write as saveError instead of swallowing it', async () => {
    seed({ 'a.md': 'a' })
    inkwell.writeNote.mockResolvedValueOnce({ ok: false, error: 'ENOSPC: disk full' })
    const st = useStore.getState()
    st.editNote('a.md', 'a2')
    await st.saveActive()
    expect(useStore.getState().saveError).toContain('a.md')
    expect(useStore.getState().saveError).toContain('ENOSPC')
    useStore.getState().dismissSaveError()
    expect(useStore.getState().saveError).toBeNull()
  })

  it('re-queues a failed write so the next flush retries it', async () => {
    seed({ 'a.md': 'a' })
    inkwell.writeNote.mockResolvedValueOnce({ ok: false, error: 'ENOSPC: disk full' })
    const st = useStore.getState()
    st.editNote('a.md', 'a2')
    await st.saveActive() // fails — the edit must go back into the buffer
    expect(useStore.getState().dirty).toBe(true)

    await st.saveActive() // retry succeeds (default mock returns ok)
    expect(inkwell.writeNote).toHaveBeenCalledTimes(2)
    // The failed attempt was a mockResolvedValueOnce (no log entry); the retry runs
    // the real mock and must carry the same text.
    const attempts = writeLog.filter((w) => w.path === 'a.md' && w.phase === 'end')
    expect(attempts.map((w) => w.text)).toEqual(['a2'])
    expect(useStore.getState().dirty).toBe(false)
  })
})

describe('renameNote', () => {
  it('rewrites referrers, skips code fences, and rewrites self-links', async () => {
    seed({
      'Old.md': 'I link to myself: [[Old]]',
      'Ref.md': 'See [[Old]] for details.\n\n```\nnot a real [[Old]] link\n```',
      'Other.md': 'No links here.'
    })
    await useStore.getState().renameNote('Old.md', 'New')

    const s = useStore.getState()
    expect(s.texts['Old.md']).toBeUndefined()
    // Referrer body rewritten, fenced occurrence untouched.
    expect(s.texts['Ref.md']).toContain('[[New]]')
    expect(s.texts['Ref.md']).toContain('not a real [[Old]] link')
    // The renamed note's own self-link follows the rename.
    expect(s.texts['New.md']).toBe('I link to myself: [[New]]')
    // Untouched notes are not rewritten to disk.
    const written = new Set(writeLog.map((w) => w.path))
    expect(written.has('Other.md')).toBe(false)
    expect(written.has('Ref.md')).toBe(true)
    expect(written.has('New.md')).toBe(true)
  })

  it('retargets canvas file cards pointing at the old path', async () => {
    seed({ 'Old.md': 'x' })
    useStore.setState({ canvases: [{ path: 'Board.canvas', name: 'Board', mtime: 1 }] })
    inkwell.readCanvas.mockResolvedValueOnce({
      nodes: [
        { id: 'n1', type: 'file', file: 'Old.md', x: 0, y: 0, width: 100, height: 80 },
        { id: 'n2', type: 'text', text: 'hi', x: 0, y: 0, width: 100, height: 80 }
      ],
      edges: []
    })
    await useStore.getState().renameNote('Old.md', 'New')
    expect(inkwell.writeCanvas).toHaveBeenCalledTimes(1)
    const doc = inkwell.writeCanvas.mock.calls[0][1] as { nodes: { file?: string }[] }
    expect(doc.nodes[0].file).toBe('New.md')
  })
})

describe('history', () => {
  it('records canvas-to-canvas navigation as separate steps', () => {
    seed({ 'a.md': 'a' })
    const st = useStore.getState()
    st.openCanvas('One.canvas')
    st.openCanvas('Two.canvas')
    const s = useStore.getState()
    expect(s.history.length).toBeGreaterThanOrEqual(2)
    st.goBack()
    expect(useStore.getState().activeCanvasPath).toBe('One.canvas')
  })
})
