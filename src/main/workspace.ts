import { createHash } from 'crypto'
import { promises as fs, realpathSync, type Stats } from 'fs'
import path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { app, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import type { AssetFile, CanvasMeta, FileEvent, NoteFile, Workspace, WriteResult } from '../shared/types.js'
import { MEDIA_EXT_SET } from '../shared/media.js'

/** Folders we never index (mirrors Octarine/Obsidian conventions). */
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.octarine', '.trash', '.verso'])

/** Every media type the app handles — single source of truth for the Assets view,
 *  the watcher, and the `verso://` protocol. Defined once in `shared/media.ts`
 *  so the renderer's asset-link filter can't drift from what main actually serves. */
export const MEDIA_EXTS = MEDIA_EXT_SET

/** Non-markdown file types surfaced in the Assets view. */
const ASSET_EXTS = MEDIA_EXTS

/** Extensions whose watcher events we forward to the renderer. */
const WATCHED_EXTS = new Set(['.md', '.canvas', ...MEDIA_EXTS])

/** Files inside the otherwise-ignored `.verso/` dir whose events we do forward. */
const VERSO_WATCHED = new Set(['.verso/bases.json', '.verso/custom.css'])

let watcher: FSWatcher | null = null
let currentRoot: string | null = null
// Bumped whenever the watcher is (re)started or closed. Handlers capture their
// generation and check it before sending, so a buffered unlink timer from vault A
// can't fire an event into vault B after a switch.
let watchGen = 0

/** Log an unexpected fs error, ignoring the benign not-found / already-exists cases. */
function logErr(context: string, e: unknown): void {
  const code = (e as { code?: string })?.code
  if (code === 'ENOENT' || code === 'EEXIST') return
  console.error(`[workspace] ${context}:`, e)
}

/** A concise, human-readable message for a write failure (e.g. "EACCES: permission denied"). */
function errMsg(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Node fs errors look like "EACCES: permission denied, open '/path'". Drop the path tail.
  return msg.split(',')[0].trim() || 'Unknown error'
}

/** Monotonic counter making each in-flight atomicWrite's temp file unique. */
let tmpSeq = 0

/**
 * Write `data` atomically: write a sibling tmp file, fsync it, rename over the
 * destination, then fsync the containing directory — so neither a process crash
 * nor a power loss mid-write can leave a truncated or empty file behind.
 *
 * Both syncs matter. Without the file sync, rename alone doesn't survive power
 * loss on all filesystems (the data must be flushed first). Without the DIRECTORY
 * sync, the rename itself may not be durable: the file content is on disk but the
 * directory entry still points at the old inode, so the write silently reverts.
 *
 * The temp name carries a per-call sequence number, not just the pid: writeNote /
 * writeCanvas / writeBases / the snapshotter all share this primitive and are not
 * serialized against each other in main, so a pid-only name let two concurrent
 * writes to the same path fight over one temp file.
 */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${tmpSeq++}.tmp`
  try {
    const fh = await fs.open(tmp, 'w')
    try {
      await fh.writeFile(data)
      await fh.sync()
    } finally {
      await fh.close()
    }
    await fs.rename(tmp, filePath)
    // Best effort: some platforms (notably Windows) refuse to open a directory,
    // and a failure here costs durability, not correctness.
    try {
      const dir = await fs.open(path.dirname(filePath), 'r')
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
    } catch {
      /* directory fsync unsupported here */
    }
  } catch (e) {
    try {
      await fs.unlink(tmp)
    } catch {
      /* best effort */
    }
    throw e
  }
}

// ---- self-write echo suppression ------------------------------------------
// Paths we just wrote ourselves, so the watcher can drop the resulting echo
// events instead of bouncing our own write back to the renderer.

const SELF_WRITE_WINDOW_MS = 2500
const selfWrites = new Map<string, number>() // relPath -> Date.now() of our write
// Kept separate from selfWrites: a delete must suppress only the `unlink` echo.
// (One shared map would also swallow a legitimate re-add — e.g. a sync tool or git
// restoring the file seconds after an in-app delete — and the renderer would never
// learn the note is back.)
const selfDeletes = new Map<string, number>() // relPath -> Date.now() of our delete/move-away

function markRecent(map: Map<string, number>, rel: string): void {
  const now = Date.now()
  map.set(rel, now)
  // Opportunistic cleanup so the map can't grow unboundedly.
  if (map.size > 128) {
    for (const [k, t] of map) if (now - t > SELF_WRITE_WINDOW_MS) map.delete(k)
  }
}

function isRecent(map: Map<string, number>, rel: string): boolean {
  const t = map.get(rel)
  if (t === undefined) return false
  if (Date.now() - t > SELF_WRITE_WINDOW_MS) {
    map.delete(rel)
    return false
  }
  return true
}

const noteSelfWrite = (rel: string): void => markRecent(selfWrites, rel)
const isRecentSelfWrite = (rel: string): boolean => isRecent(selfWrites, rel)
const noteSelfDelete = (rel: string): void => markRecent(selfDeletes, rel)
const isRecentSelfDelete = (rel: string): boolean => isRecent(selfDeletes, rel)

// Content-based echo detection (in addition to the timer): the hash of what we
// last WROTE to each path. A change event whose on-disk content still matches is
// our own write echoing back — however late it arrives (slow disks and network
// mounts routinely outlive the 2.5s window; a timer alone misses those).
const lastWrittenHash = new Map<string, string>()

const contentHash = (text: string | Buffer): string => createHash('sha1').update(text).digest('hex')

function noteWrittenContent(rel: string, text: string | Buffer): void {
  lastWrittenHash.set(rel, contentHash(text))
  if (lastWrittenHash.size > 512) {
    // Drop the oldest entries (Map preserves insertion order).
    for (const k of lastWrittenHash.keys()) {
      if (lastWrittenHash.size <= 256) break
      lastWrittenHash.delete(k)
    }
  }
}

/** True when the file's CURRENT disk content is exactly what we last wrote. */
async function isOwnContentEcho(abs: string, rel: string): Promise<boolean> {
  const want = lastWrittenHash.get(rel)
  if (want === undefined) return false
  try {
    return contentHash(await fs.readFile(abs)) === want
  } catch {
    return false
  }
}

/** Convert an absolute path under root into a workspace-relative POSIX path. */
function toRelative(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

function isMarkdown(p: string): boolean {
  return p.toLowerCase().endsWith('.md')
}

async function statFile(root: string, abs: string): Promise<NoteFile> {
  const stat = await fs.stat(abs)
  const rel = toRelative(root, abs)
  return {
    path: rel,
    name: path.basename(rel).replace(/\.md$/i, ''),
    mtime: stat.mtimeMs
  }
}

/** How many directory reads / file stats to have in flight at once. Enough to keep
 *  the syscall pipeline busy, well under any descriptor limit. */
const WALK_CONCURRENCY = 64

/**
 * Collect all .md files under root, skipping ignored/dot dirs.
 *
 * This runs BEFORE the renderer is handed the workspace, so it sits directly on the
 * cold-start path. It used to recurse depth-first with a sequential `await` per
 * subdirectory AND per file stat — on a few thousand notes that is a few thousand
 * serialized syscall round trips, and it dominated startup. Now directories are read
 * in parallel batches and file stats are issued in bounded-parallel batches.
 *
 * Results are sorted by path so the file list (and therefore which note opens on
 * launch) is deterministic instead of depending on filesystem readdir order.
 */
async function collectNotes(root: string): Promise<NoteFile[]> {
  const fileAbs: string[] = []
  const frontier = [root]

  while (frontier.length) {
    const batch = frontier.splice(0, WALK_CONCURRENCY)
    const listings = await Promise.all(
      batch.map(async (dir) => {
        try {
          return { dir, entries: await fs.readdir(dir, { withFileTypes: true }) }
        } catch (e) {
          // One unreadable subdirectory (EACCES, cloud-sync placeholder) must not
          // fail the whole vault open — skip it, like listAssets/listCanvases do.
          if (dir === root) throw e // ...but an unreadable ROOT is a real failure
          logErr(`collectNotes ${dir}`, e)
          return null
        }
      })
    )
    for (const listing of listings) {
      if (!listing) continue
      for (const entry of listing.entries) {
        const abs = path.join(listing.dir, entry.name)
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          if (entry.name.startsWith('.')) continue // hidden dot-folders
          frontier.push(abs)
        } else if (entry.isFile() && isMarkdown(entry.name)) {
          fileAbs.push(abs)
        }
      }
    }
  }

  const out: NoteFile[] = []
  for (let i = 0; i < fileAbs.length; i += WALK_CONCURRENCY) {
    const chunk = await Promise.all(
      fileAbs.slice(i, i + WALK_CONCURRENCY).map(async (abs) => {
        try {
          return await statFile(root, abs)
        } catch (e) {
          logErr(`collectNotes stat ${abs}`, e)
          return null
        }
      })
    )
    for (const f of chunk) if (f) out.push(f)
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/** True if watcher events for this absolute path should be forwarded to the renderer. */
function isWatchedFile(root: string, abs: string): boolean {
  const rel = toRelative(root, abs)
  if (VERSO_WATCHED.has(rel)) return true
  if (rel.startsWith('.verso/')) return false
  return WATCHED_EXTS.has(path.extname(abs).toLowerCase())
}

/** How long an unlink waits for a matching add before flushing as a plain unlink. */
const RENAME_PAIR_WINDOW_MS = 400

/** Begin watching `root` and forward file events to the renderer. */
async function startWatching(root: string, win: BrowserWindow): Promise<void> {
  if (watcher) {
    try {
      await watcher.close()
    } catch (e) {
      logErr('startWatching close', e)
    }
    watcher = null
  }
  const gen = ++watchGen
  watcher = chokidar.watch(root, {
    ignored: (p: string) => {
      const rel = toRelative(root, p)
      // Carve-out: descend into `.verso/` just far enough to see bases.json / custom.css.
      if (rel === '.verso' || VERSO_WATCHED.has(rel)) return false
      if (rel.startsWith('.verso/')) return true
      const base = path.basename(p)
      return (
        IGNORED_DIRS.has(base) ||
        (base.startsWith('.') && base !== path.basename(root))
      )
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })

  const send = (event: FileEvent): void => {
    // A stale generation means the workspace switched under us (a late buffered
    // timer or in-flight stat) — the event belongs to the previous vault.
    if (gen !== watchGen) return
    if (!win.isDestroyed()) win.webContents.send('file-event', event)
  }

  // Rename detection: buffer unlinks briefly (keyed by basename) so an add of the
  // same basename elsewhere within the window pairs into a single 'rename' event.
  const pendingUnlinks = new Map<string, { rel: string; timer: ReturnType<typeof setTimeout> }>()

  watcher
    .on('add', async (p) => {
      try {
        if (!isWatchedFile(root, p)) return
        const rel = toRelative(root, p)
        const base = path.basename(p)
        const pending = pendingUnlinks.get(base)
        if (pending) {
          clearTimeout(pending.timer)
          pendingUnlinks.delete(base)
          if (pending.rel !== rel) {
            let file: NoteFile | undefined
            try {
              file = await statFile(root, p)
            } catch {
              /* stat is best-effort on renames */
            }
            send({ type: 'rename', path: rel, oldPath: pending.rel, file })
            return
          }
          // Same path unlinked+re-added (e.g. an atomic replace): fall through as a plain add.
        }
        // Drop the add echo of our own atomic write (rename creates an 'add' if untracked).
        if (isRecentSelfWrite(rel)) return
        send({ type: 'add', file: await statFile(root, p) })
      } catch (e) {
        logErr(`watch add ${p}`, e) // logErr already skips ENOENT
      }
    })
    .on('change', async (p) => {
      try {
        if (!isWatchedFile(root, p)) return
        const rel = toRelative(root, p)
        if (isRecentSelfWrite(rel)) return // our own write echoing back (fast path)
        // Slow echoes (network mounts, laggy disks) outlive the timer — recognize
        // them by CONTENT: if the disk still holds exactly what we last wrote,
        // there is nothing new to tell the renderer.
        if (await isOwnContentEcho(p, rel)) return
        send({ type: 'change', file: await statFile(root, p) })
      } catch (e) {
        logErr(`watch change ${p}`, e) // logErr already skips ENOENT
      }
    })
    .on('unlink', (p) => {
      try {
        if (!isWatchedFile(root, p)) return
        const rel = toRelative(root, p)
        if (isRecentSelfDelete(rel)) return // our own delete/rename echoing back
        const base = path.basename(p)
        // Flush any older pending unlink with the same basename as a plain unlink.
        const prior = pendingUnlinks.get(base)
        if (prior) {
          clearTimeout(prior.timer)
          pendingUnlinks.delete(base)
          send({ type: 'unlink', path: prior.rel })
        }
        const timer = setTimeout(() => {
          const entry = pendingUnlinks.get(base)
          if (entry && entry.rel === rel) {
            pendingUnlinks.delete(base)
            send({ type: 'unlink', path: rel })
          }
        }, RENAME_PAIR_WINDOW_MS)
        pendingUnlinks.set(base, { rel, timer })
      } catch (e) {
        logErr(`watch unlink ${p}`, e)
      }
    })
    .on('error', (e) => logErr('watcher', e))
}

// Workspace switches are serialized: two racing loads could otherwise interleave
// watcher close/start and leave the watcher on the losing root.
let openChain: Promise<unknown> = Promise.resolve()

/** Open (or re-open) a workspace at `root`, returning its note list. */
export function openWorkspaceAt(root: string, win: BrowserWindow): Promise<Workspace | null> {
  const next = openChain.then(
    () => doOpenWorkspaceAt(root, win),
    () => doOpenWorkspaceAt(root, win)
  )
  openChain = next
  return next
}

async function doOpenWorkspaceAt(root: string, win: BrowserWindow): Promise<Workspace | null> {
  try {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) return null
  } catch (e) {
    logErr('openWorkspaceAt stat', e)
    return null
  }
  // Normalize to the real path so a symlinked workspace root still passes the guards.
  try {
    root = realpathSync(root)
  } catch (e) {
    logErr('openWorkspaceAt realpath', e)
  }
  // Fully stop the old watcher before switching roots so its late events can't
  // fire against the new workspace's state.
  if (watcher) {
    try {
      await watcher.close()
    } catch (e) {
      logErr('openWorkspaceAt close watcher', e)
    }
    watcher = null
  }
  watchGen++ // invalidate any still-buffered timers from the old watcher
  knownMtimes.clear() // conflict baselines belong to the previous vault
  lastStat.clear()
  lastSnapshotAt.clear()
  lastWrittenHash.clear()
  try {
    const files = await collectNotes(root)
    currentRoot = root
    await startWatching(root, win)
    return { root, files }
  } catch (e) {
    logErr('openWorkspaceAt collect', e)
    return null
  }
}

/**
 * True if `target` is strictly inside `root`. Uses `path.relative` rather than a
 * `startsWith(root + sep)` string check so separators and case quirks are handled
 * by the platform's path semantics.
 */
function isWithinRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * True if `abs` — or, for a not-yet-created file, its nearest existing ancestor —
 * resolves through symlinks to a real path outside the workspace root. Defends
 * against a symlink planted inside the vault that points elsewhere.
 *
 * Async on purpose. This runs on EVERY note read/write, and the synchronous
 * `realpathSync` it used to call blocked the main process's event loop — which
 * also stalls the file watcher and every other IPC handler. On a network mount
 * or a cloud-sync placeholder folder that is a visible freeze, and the loop
 * walking up ancestors could issue several blocking calls per write.
 */
async function escapesRoot(abs: string): Promise<boolean> {
  if (!currentRoot) return true
  let p = abs
  for (;;) {
    try {
      const real = await fs.realpath(p)
      const tail = path.relative(p, abs)
      const full = tail ? path.resolve(real, tail) : real
      return !isWithinRoot(currentRoot, full)
    } catch {
      const parent = path.dirname(p)
      if (parent === p) return false // reached the fs root; the string guard already passed
      p = parent
    }
  }
}

async function resolveInRoot(rel: string): Promise<string> {
  if (!currentRoot) throw new Error('No workspace open')
  const abs = path.resolve(currentRoot, rel)
  // Path-containment guard against `..` traversal, then a symlink-aware guard.
  if (!isWithinRoot(currentRoot, abs) || (await escapesRoot(abs))) {
    throw new Error('Path escapes workspace')
  }
  return abs
}

/** No path segment may be empty or dot-prefixed: the app never legitimately
 *  touches files under `.git/`, `.verso/`, `.obsidian/`, … through the generic
 *  file channels (they have dedicated, fixed-path accessors), and writing there
 *  is an escalation surface — e.g. a compromised renderer planting a git hook. */
function hasCleanSegments(rel: string): boolean {
  const segs = rel.split('/')
  return segs.length > 0 && segs.every((s) => s !== '' && !s.startsWith('.'))
}

/** Guard for the note read/write/create/rename channels: real `.md` paths only.
 *  Canvases, bases, css, assets each have their own (stricter) entry points. */
function isSafeNotePath(rel: string): boolean {
  return isMarkdown(rel) && hasCleanSegments(rel)
}

/**
 * Read a batch of notes by workspace-relative path. Unreadable or unsafe paths are
 * omitted rather than failing the batch.
 *
 * The renderer calls this in chunks so it can paint and stay responsive while the
 * vault hydrates, instead of blocking on one read-the-entire-vault round trip.
 */
export async function readNotes(rels: string[]): Promise<{ path: string; text: string }[]> {
  if (!currentRoot) return []
  // Bounded concurrency: a Promise.all over every file opens tens of thousands of
  // descriptors at once and hits the OS limit (EMFILE) on large vaults.
  const CONCURRENCY = 64
  const out: { path: string; text: string }[] = []
  for (let i = 0; i < rels.length; i += CONCURRENCY) {
    const chunk = await Promise.all(
      rels.slice(i, i + CONCURRENCY).map(async (rel) => {
        const text = await readNote(rel)
        return text === null ? null : { path: rel, text }
      })
    )
    for (const r of chunk) if (r) out.push(r)
  }
  return out
}

// ---- sync-conflict detection -----------------------------------------------
// `knownMtimes[rel]` is the file's mtime as of the app's last READ or WRITE of
// it. A write finding a NEWER mtime on disk means something else (sync tool,
// another editor) changed the file while the renderer held unsaved edits — the
// exact window the renderer's pending-buffer guard can't see. Watcher events do
// NOT update this map: only a renderer read does, so a change the renderer
// skipped (pending buffer) still registers as a conflict at flush time.

const knownMtimes = new Map<string, number>()

/** A sibling path for the preserved other version: `Note (conflict 14-32-05).md`. */
function conflictPathFor(rel: string): string {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-')
  return rel.replace(/\.md$/i, '') + ` (conflict ${stamp}).md`
}

export async function readNote(rel: string): Promise<string | null> {
  if (!isSafeNotePath(rel)) return null
  try {
    const abs = await resolveInRoot(rel)
    const text = await fs.readFile(abs, 'utf8')
    try {
      const st = await fs.stat(abs)
      knownMtimes.set(rel, st.mtimeMs)
      lastStat.set(rel, { m: st.mtimeMs, s: st.size })
    } catch {
      /* stat is best-effort */
    }
    return text
  } catch (e) {
    logErr(`readNote ${rel}`, e)
    return null
  }
}

// ---- persistent parse cache ------------------------------------------------
// Parsing every note is ~20% of a cold start and is repeated on EVERY launch even
// though almost nothing changed since the last one. The renderer hands its parse
// results back here; we key them by (mtime, size) and return them next launch, so
// only files that actually changed are re-parsed. The renderer still reads every
// note's text — this removes the parse, not the I/O.
//
// The cache is only ever an optimisation: any mismatch, corruption or version
// change silently degrades to "parse it again".

/** Stat as of our last READ of each file, so a parse handed back later can be
 *  stamped with the version of the file it was actually derived from. */
const lastStat = new Map<string, { m: number; s: number }>()

/** Bump when parse output changes shape. The app version is part of the key too,
 *  so a release always invalidates — this is for changes within one version. */
const PARSE_CACHE_VERSION = 1

interface ParseCacheEntry {
  m: number
  s: number
  p: unknown
}
let parseCache = new Map<string, ParseCacheEntry>()
let parseCacheRoot: string | null = null
let parseCacheDirty = false
let parseCacheTimer: ReturnType<typeof setTimeout> | null = null
/** Dev reloads parse.ts constantly and the app version doesn't move — a stale
 *  cache there would be a genuinely confusing bug, so don't keep one. */
const parseCacheEnabled = !process.env.ELECTRON_RENDERER_URL

function parseCacheFile(root: string): string {
  const key = createHash('sha1').update(root).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'parse-cache', `${key}.json`)
}

async function loadParseCache(root: string): Promise<void> {
  parseCache = new Map()
  parseCacheRoot = root
  parseCacheDirty = false
  if (!parseCacheEnabled) return
  try {
    const raw = await fs.readFile(parseCacheFile(root), 'utf8')
    const data = JSON.parse(raw) as { v?: number; app?: string; entries?: Record<string, ParseCacheEntry> }
    if (data.v !== PARSE_CACHE_VERSION || data.app !== app.getVersion() || !data.entries) return
    parseCache = new Map(Object.entries(data.entries))
  } catch {
    /* no cache, unreadable, or corrupt — parse everything, as before */
  }
}

async function flushParseCache(): Promise<void> {
  if (!parseCacheDirty || !parseCacheRoot || !parseCacheEnabled) return
  parseCacheDirty = false
  const file = parseCacheFile(parseCacheRoot)
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await atomicWrite(
      file,
      JSON.stringify({
        v: PARSE_CACHE_VERSION,
        app: app.getVersion(),
        entries: Object.fromEntries(parseCache)
      })
    )
  } catch (e) {
    logErr('flushParseCache', e)
  }
}

/**
 * Read a batch of notes, attaching each one's cached parse when the file on disk
 * still matches the version the cache was built from. `parsed: null` means the
 * renderer must parse it (and hand the result back via `saveParseCache`).
 */
export async function readNotesCached(
  rels: string[]
): Promise<{ path: string; text: string; parsed: unknown | null }[]> {
  if (!currentRoot) return []
  if (parseCacheRoot !== currentRoot) await loadParseCache(currentRoot)
  const texts = await readNotes(rels)
  return texts.map(({ path: p, text }) => {
    const hit = parseCache.get(p)
    const st = lastStat.get(p)
    const fresh = hit && st && hit.m === st.m && hit.s === st.s
    return { path: p, text, parsed: fresh ? hit.p : null }
  })
}

/** Store parses the renderer just computed, stamped with the file version they
 *  came from. Writing is debounced — hydration calls this once per batch. */
export function saveParseCache(entries: { path: string; parsed: unknown }[]): void {
  if (!parseCacheEnabled || !currentRoot) return
  if (parseCacheRoot !== currentRoot) return // a vault switch raced us; next batch will land
  for (const e of entries) {
    const st = lastStat.get(e.path)
    if (st) parseCache.set(e.path, { m: st.m, s: st.s, p: e.parsed })
  }
  parseCacheDirty = true
  if (parseCacheTimer) clearTimeout(parseCacheTimer)
  parseCacheTimer = setTimeout(() => {
    parseCacheTimer = null
    void flushParseCache()
  }, 3000)
}

/** Persist immediately (app quit) — the debounce may not have fired. */
export async function flushParseCacheNow(): Promise<void> {
  if (parseCacheTimer) clearTimeout(parseCacheTimer)
  parseCacheTimer = null
  await flushParseCache()
}

// ---- local snapshots (`.verso/history/<note path>/<stamp>.md`) --------------
// A safety net between the 600ms debounced write and the OS Trash: before a
// note is overwritten, its current disk content is snapshotted — at most once
// per SNAPSHOT_INTERVAL_MS per note, deduped against the newest snapshot, and
// pruned to SNAPSHOT_KEEP versions. The watcher ignores `.verso/`, so snapshot
// writes cause no event churn; the dir syncs with the vault (that's a feature —
// history survives reinstalls) but can be .stignore'd if unwanted.

const SNAPSHOT_INTERVAL_MS = 10 * 60_000
const SNAPSHOT_KEEP = 20
const lastSnapshotAt = new Map<string, number>()

function historyDirFor(rel: string): string {
  return path.join(currentRoot!, '.verso', 'history', ...rel.split('/'))
}

export interface SnapshotMeta {
  /** Timestamp id, filename-safe (e.g. `2026-07-14T18-30-05`). */
  stamp: string
  size: number
}

export async function listSnapshots(rel: string): Promise<SnapshotMeta[]> {
  if (!currentRoot || !isSafeNotePath(rel)) return [] // rel is joined under .verso/history — never let `..` in
  try {
    const dir = historyDirFor(rel)
    const names = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort().reverse()
    const out: SnapshotMeta[] = []
    for (const n of names) {
      try {
        const stat = await fs.stat(path.join(dir, n))
        out.push({ stamp: n.replace(/\.md$/, ''), size: stat.size })
      } catch {
        /* skip unreadable */
      }
    }
    return out
  } catch {
    return [] // no history yet
  }
}

export async function readSnapshot(rel: string, stamp: string): Promise<string | null> {
  if (!currentRoot || !isSafeNotePath(rel) || !/^[\w:.T-]+$/.test(stamp)) return null
  try {
    return await fs.readFile(path.join(historyDirFor(rel), `${stamp}.md`), 'utf8')
  } catch (e) {
    logErr(`readSnapshot ${rel} ${stamp}`, e)
    return null
  }
}

/** Snapshot the CURRENT disk content of `rel` (about to be overwritten). */
async function maybeSnapshot(rel: string, abs: string): Promise<void> {
  const now = Date.now()
  if ((lastSnapshotAt.get(rel) ?? 0) > now - SNAPSHOT_INTERVAL_MS) return
  try {
    const cur = await fs.readFile(abs, 'utf8')
    if (cur.trim() === '') return // nothing worth keeping
    const dir = historyDirFor(rel)
    await fs.mkdir(dir, { recursive: true })
    const names = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    const newest = names[names.length - 1]
    if (newest && (await fs.readFile(path.join(dir, newest), 'utf8')) === cur) {
      lastSnapshotAt.set(rel, now)
      return // identical to the latest snapshot
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    await fs.writeFile(path.join(dir, `${stamp}.md`), cur)
    for (const n of names.slice(0, Math.max(0, names.length + 1 - SNAPSHOT_KEEP))) {
      await fs.unlink(path.join(dir, n)).catch(() => {})
    }
    lastSnapshotAt.set(rel, now)
  } catch (e) {
    logErr(`snapshot ${rel}`, e) // never block the write on a failed snapshot
  }
}

export async function writeNote(rel: string, text: string): Promise<WriteResult> {
  if (!isSafeNotePath(rel)) return { ok: false, error: 'Not a note path' }
  try {
    const abs = await resolveInRoot(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await maybeSnapshot(rel, abs)

    // Conflict check: has the file changed on disk since the app last saw it?
    let conflictPath: string | undefined
    const known = knownMtimes.get(rel)
    if (known !== undefined) {
      try {
        const stat = await fs.stat(abs)
        if (stat.mtimeMs > known + 1) {
          const theirs = await fs.readFile(abs, 'utf8')
          // Same content (e.g. a touch, or the sync tool writing our own bytes
          // back) is not a conflict.
          if (theirs !== text) {
            conflictPath = conflictPathFor(rel)
            await atomicWrite(await resolveInRoot(conflictPath), theirs)
            // Deliberately NOT echo-suppressed: the watcher's `add` for the
            // conflict file is how it appears in the renderer's sidebar.
          }
        }
      } catch {
        /* destination missing — plain create, no conflict */
      }
    }

    await atomicWrite(abs, text)
    noteSelfWrite(rel)
    noteWrittenContent(rel, text)
    try {
      knownMtimes.set(rel, (await fs.stat(abs)).mtimeMs)
    } catch {
      /* stat is best-effort */
    }
    return conflictPath ? { ok: true, conflictPath } : { ok: true }
  } catch (e) {
    logErr(`writeNote ${rel}`, e)
    return { ok: false, error: errMsg(e) }
  }
}

export async function createNote(rel: string, text: string): Promise<NoteFile | null> {
  if (!isSafeNotePath(rel)) return null
  try {
    const abs = await resolveInRoot(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    // Don't clobber an existing file.
    await fs.writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
    const created = await statFile(currentRoot!, abs)
    knownMtimes.set(rel, created.mtime)
    return created
  } catch (e) {
    logErr(`createNote ${rel}`, e)
    return null
  }
}

export async function renameNote(oldRel: string, newRel: string): Promise<NoteFile | null> {
  if (!isSafeNotePath(oldRel) || !isSafeNotePath(newRel)) return null
  try {
    const from = await resolveInRoot(oldRel)
    const to = await resolveInRoot(newRel)
    if (from === to) return statFile(currentRoot!, to)
    // Refuse to clobber an existing file.
    try {
      await fs.access(to)
      return null
    } catch {
      /* target is free */
    }
    await fs.mkdir(path.dirname(to), { recursive: true })
    // Suppress our own watcher echo: the move lands as unlink(old) + add(new). The
    // renderer already applied the rename — the echo would re-read disk and clobber
    // keystrokes typed right after the rename.
    noteSelfDelete(oldRel)
    noteSelfWrite(newRel)
    await fs.rename(from, to)
    const moved = await statFile(currentRoot!, to)
    knownMtimes.delete(oldRel)
    knownMtimes.set(newRel, moved.mtime)
    return moved
  } catch (e) {
    logErr(`renameNote ${oldRel} -> ${newRel}`, e)
    return null
  }
}

export async function deleteNote(rel: string): Promise<boolean> {
  // Shared by the note/asset/canvas delete channels, so any extension — but
  // never dot-paths (.git, .verso, …); those aren't user files.
  if (!hasCleanSegments(rel)) return false
  try {
    const abs = await resolveInRoot(rel)
    noteSelfDelete(rel) // suppress the unlink echo (the renderer already removed it)
    await shell.trashItem(abs)
    knownMtimes.delete(rel)
    return true
  } catch (e) {
    logErr(`deleteNote ${rel}`, e)
    return false
  }
}

export async function revealNote(rel: string): Promise<void> {
  try {
    shell.showItemInFolder(await resolveInRoot(rel))
  } catch (e) {
    logErr(`revealNote ${rel}`, e)
  }
}

/** Save a base64 asset into `assets/`, returning its workspace-relative path. */
export async function saveAsset(filename: string, base64: string): Promise<string | null> {
  if (!currentRoot) return null
  try {
    const dir = path.join(currentRoot, 'assets')
    await fs.mkdir(dir, { recursive: true })
    const ext = path.extname(filename)
    const base = path.basename(filename, ext).replace(/[^\w-]+/g, '_') || 'asset'
    let name = `${base}${ext}`
    let i = 1
    for (;;) {
      try {
        await fs.access(path.join(dir, name))
        name = `${base}-${i++}${ext}`
      } catch {
        break
      }
    }
    await fs.writeFile(path.join(dir, name), Buffer.from(base64, 'base64'))
    return `assets/${name}`
  } catch (e) {
    logErr(`saveAsset ${filename}`, e)
    return null
  }
}

/**
 * Walk the vault in parallel batches, returning the absolute paths of files matching
 * `keep`. Shared by the asset and canvas listers, which were each doing the same
 * sequential depth-first recursion as collectNotes.
 */
async function walkFiles(root: string, keep: (name: string) => boolean): Promise<string[]> {
  const found: string[] = []
  const frontier = [root]
  while (frontier.length) {
    const batch = frontier.splice(0, WALK_CONCURRENCY)
    const listings = await Promise.all(
      batch.map(async (dir) => {
        try {
          return { dir, entries: await fs.readdir(dir, { withFileTypes: true }) }
        } catch {
          return null // skip unreadable
        }
      })
    )
    for (const listing of listings) {
      if (!listing) continue
      for (const entry of listing.entries) {
        const abs = path.join(listing.dir, entry.name)
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
          frontier.push(abs)
        } else if (entry.isFile() && keep(entry.name)) {
          found.push(abs)
        }
      }
    }
  }
  return found
}

/** Stat `paths` in bounded-parallel batches, dropping any that fail. */
async function statAll<T>(paths: string[], make: (abs: string, stat: Stats) => T): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < paths.length; i += WALK_CONCURRENCY) {
    const chunk = await Promise.all(
      paths.slice(i, i + WALK_CONCURRENCY).map(async (abs) => {
        try {
          return make(abs, await fs.stat(abs))
        } catch {
          return null // skip unreadable
        }
      })
    )
    for (const r of chunk) if (r !== null) out.push(r)
  }
  return out
}

/** Recursively list every non-markdown asset under root (skipping ignored/dot dirs). */
export async function listAssets(): Promise<AssetFile[]> {
  if (!currentRoot) return []
  const root = currentRoot
  const paths = await walkFiles(root, (name) => ASSET_EXTS.has(path.extname(name).toLowerCase()))
  return statAll(paths, (abs, stat) => ({
    path: toRelative(root, abs),
    name: path.basename(abs),
    ext: path.extname(abs).slice(1).toLowerCase(),
    size: stat.size,
    added: stat.birthtimeMs || stat.mtimeMs
  }))
}

/** Resolve a workspace-relative path to an absolute path inside the vault, or null. */
export async function resolveAsset(rel: string): Promise<string | null> {
  if (!currentRoot || !hasCleanSegments(rel)) return null
  const abs = path.join(currentRoot, rel)
  if (!isWithinRoot(currentRoot, abs)) return null
  if (await escapesRoot(abs)) return null
  return abs
}

// ---- spatial canvases (`.canvas` files, Obsidian-compatible JSON) ----

function isCanvas(p: string): boolean {
  return p.toLowerCase().endsWith('.canvas') && hasCleanSegments(p)
}

function canvasMeta(root: string, abs: string, mtimeMs: number): CanvasMeta {
  const rel = toRelative(root, abs)
  return { path: rel, name: path.basename(rel).replace(/\.canvas$/i, ''), mtime: mtimeMs }
}

/** Recursively list every `.canvas` file under root (skipping ignored/dot dirs), newest first. */
export async function listCanvases(): Promise<CanvasMeta[]> {
  if (!currentRoot) return []
  const root = currentRoot
  const paths = await walkFiles(root, isCanvas)
  const out = await statAll(paths, (abs, stat) => canvasMeta(root, abs, stat.mtimeMs))
  return out.sort((a, b) => b.mtime - a.mtime)
}

export async function readCanvas(rel: string): Promise<unknown> {
  if (!isCanvas(rel)) return null
  try {
    return JSON.parse(await fs.readFile(await resolveInRoot(rel), 'utf8'))
  } catch (e) {
    logErr(`readCanvas ${rel}`, e)
    return null
  }
}

export async function writeCanvas(rel: string, data: unknown): Promise<WriteResult> {
  if (!isCanvas(rel)) return { ok: false, error: 'Not a .canvas path' }
  try {
    const abs = await resolveInRoot(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    const json = JSON.stringify(data, null, 2)
    await atomicWrite(abs, json)
    noteSelfWrite(rel)
    noteWrittenContent(rel, json)
    return { ok: true }
  } catch (e) {
    logErr(`writeCanvas ${rel}`, e)
    return { ok: false, error: errMsg(e) }
  }
}

export async function createCanvas(rel: string): Promise<CanvasMeta | null> {
  if (!isCanvas(rel)) return null
  try {
    const abs = await resolveInRoot(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    // Don't clobber an existing file.
    await fs.writeFile(abs, JSON.stringify({ nodes: [], edges: [] }, null, 2), { encoding: 'utf8', flag: 'wx' })
    const stat = await fs.stat(abs)
    return canvasMeta(currentRoot!, abs, stat.mtimeMs)
  } catch (e) {
    logErr(`createCanvas ${rel}`, e)
    return null
  }
}

export async function renameCanvas(oldRel: string, newRel: string): Promise<CanvasMeta | null> {
  if (!isCanvas(oldRel) || !isCanvas(newRel)) return null
  try {
    const from = await resolveInRoot(oldRel)
    const to = await resolveInRoot(newRel)
    if (from === to) {
      const stat = await fs.stat(to)
      return canvasMeta(currentRoot!, to, stat.mtimeMs)
    }
    try {
      await fs.access(to)
      return null // refuse to clobber
    } catch {
      /* target is free */
    }
    await fs.mkdir(path.dirname(to), { recursive: true })
    noteSelfDelete(oldRel)
    noteSelfWrite(newRel)
    await fs.rename(from, to)
    const stat = await fs.stat(to)
    return canvasMeta(currentRoot!, to, stat.mtimeMs)
  } catch (e) {
    logErr(`renameCanvas ${oldRel} -> ${newRel}`, e)
    return null
  }
}

/** Saved Bases live in `<root>/.verso/bases.json` so they travel with the vault. */
export async function readBases(): Promise<unknown> {
  if (!currentRoot) return null
  try {
    return JSON.parse(await fs.readFile(path.join(currentRoot, '.verso', 'bases.json'), 'utf8'))
  } catch (e) {
    logErr('readBases', e)
    return null
  }
}

export async function writeBases(data: unknown): Promise<WriteResult> {
  if (!currentRoot) return { ok: false, error: 'No workspace open' }
  try {
    const dir = path.join(currentRoot, '.verso')
    await fs.mkdir(dir, { recursive: true })
    const json = JSON.stringify(data, null, 2)
    await atomicWrite(path.join(dir, 'bases.json'), json)
    noteSelfWrite('.verso/bases.json')
    noteWrittenContent('.verso/bases.json', json)
    return { ok: true }
  } catch (e) {
    logErr('writeBases', e)
    return { ok: false, error: errMsg(e) }
  }
}

/** Read the vault's custom stylesheet (`<root>/.verso/custom.css`), or null if missing. */
export async function readCustomCss(): Promise<string | null> {
  if (!currentRoot) return null
  try {
    return await fs.readFile(path.join(currentRoot, '.verso', 'custom.css'), 'utf8')
  } catch {
    return null // no custom css (or unreadable) — treat as absent
  }
}

/** The user's per-vault spellcheck ignore list (`<root>/.verso/dictionary.json`). */
export async function readUserDictionary(): Promise<string[]> {
  if (!currentRoot) return []
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(currentRoot, '.verso', 'dictionary.json'), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : []
  } catch {
    return [] // no list yet
  }
}

// Dictionary writes are chained: two rapid adds would otherwise both read the old
// list and the second write would drop the first word (same pattern as prefs).
let dictChain: Promise<string[]> = Promise.resolve([])

/** Append a word to the per-vault ignore list (deduped, case-insensitive). Returns the new list. */
export function addUserDictionaryWord(word: string): Promise<string[]> {
  const next = dictChain.then(
    () => doAddDictionaryWord(word),
    () => doAddDictionaryWord(word)
  )
  dictChain = next
  return next
}

async function doAddDictionaryWord(word: string): Promise<string[]> {
  if (!currentRoot) return []
  const list = await readUserDictionary()
  if (list.some((w) => w.toLowerCase() === word.toLowerCase())) return list
  const next = [...list, word]
  try {
    const dir = path.join(currentRoot, '.verso')
    await fs.mkdir(dir, { recursive: true })
    await atomicWrite(path.join(dir, 'dictionary.json'), JSON.stringify(next, null, 2))
  } catch (e) {
    logErr('addUserDictionaryWord', e)
  }
  return next
}

export function closeWatcher(): void {
  watchGen++ // invalidate buffered rename-pair timers along with the watcher
  watcher?.close().catch((e) => logErr('closeWatcher', e))
  watcher = null
}
