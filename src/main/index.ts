import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { promises as fs } from 'fs'
import { promises as dns } from 'dns'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  addUserDictionaryWord,
  atomicWrite,
  closeWatcher,
  createCanvas,
  createNote,
  deleteNote,
  listAssets,
  listCanvases,
  openWorkspaceAt,
  readBases,
  readCanvas,
  readCustomCss,
  renameCanvas,
  writeBases,
  writeCanvas,
  readAllNotes,
  readNote,
  readUserDictionary,
  renameNote,
  resolveAsset,
  revealNote,
  saveAsset,
  writeNote
} from './workspace.js'
import { addIgnoreWord, checkWords, setIgnoreWords, suggestWord } from './spell.js'

// Must run before app is ready: lets `verso://` load in <img> and via fetch.
protocol.registerSchemesAsPrivileged([
  { scheme: 'verso', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
import type { NoteContent, WriteResult } from '../shared/types.js'
import { PROD_CSP } from '../shared/csp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

/** Path to the tiny JSON file where we remember the last opened workspace. */
function prefsPath(): string {
  return path.join(app.getPath('userData'), 'verso-prefs.json')
}

/** One-time migration: before 0.2 the prefs file used the old internal codename. */
async function migrateLegacyPrefs(): Promise<void> {
  try {
    const legacy = path.join(app.getPath('userData'), 'inkwell-prefs.json')
    await fs.access(prefsPath()).catch(async () => {
      await fs.rename(legacy, prefsPath())
    })
  } catch {
    /* no legacy file — nothing to migrate */
  }
}

/** App-level prefs (not per-vault): the active vault plus the list of known vaults. */
interface Prefs {
  lastWorkspace?: string
  /** All vaults the user has opened, most-recent first. */
  vaults?: string[]
}

async function readPrefs(): Promise<Prefs> {
  try {
    return JSON.parse(await fs.readFile(prefsPath(), 'utf8'))
  } catch {
    return {}
  }
}

async function writePrefs(prefs: Prefs): Promise<void> {
  try {
    await atomicWrite(prefsPath(), JSON.stringify(prefs, null, 2))
  } catch (e) {
    console.error('[main] writePrefs:', e)
  }
}

// Serialize prefs read-modify-writes through a promise chain so concurrent IPC
// calls can't interleave and lose each other's updates.
let prefsChain: Promise<unknown> = Promise.resolve()
function withPrefs<T>(fn: () => Promise<T>): Promise<T> {
  const run = prefsChain.then(fn, fn)
  prefsChain = run.catch(() => {}) // keep the chain alive after a failure
  return run
}

/** Remember `root` as the active vault and move it to the front of the known list. */
async function rememberWorkspace(root: string): Promise<void> {
  await withPrefs(async () => {
    const prefs = await readPrefs()
    const prev = prefs.vaults ?? (prefs.lastWorkspace ? [prefs.lastWorkspace] : [])
    const vaults = [root, ...prev.filter((v) => v !== root)]
    await writePrefs({ lastWorkspace: root, vaults })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium's spellchecker is only enabled on macOS, where it uses the OS-native
      // (offline) checker. On Linux/Windows Chromium silently downloads its Hunspell
      // dictionaries from a Google CDN — Verso's own bundled nspell pipeline already
      // covers spellcheck there, so keep the app fully offline instead.
      spellcheck: process.platform === 'darwin'
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Forward renderer console + crashes to the terminal so dev errors are visible.
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    const first = args[0]
    const msg =
      first && typeof first === 'object' && 'message' in first
        ? (first as { message: string }).message
        : String(args[2] ?? '')
    console.log('[renderer]', msg)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details.reason)
  })

  // Open external links in the OS browser, not in-app — but only for safe schemes.
  // Anything else (file:, javascript:, custom protocols, …) is silently dropped.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const proto = new URL(url).protocol
      if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') {
        shell.openExternal(url)
      }
    } catch {
      /* unparseable URL — drop it */
    }
    return { action: 'deny' }
  })

  // Never let the window navigate away from the app itself. In dev, allow
  // navigations within the Vite dev server origin (HMR full reloads).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) {
      try {
        if (new URL(url).origin === new URL(devUrl).origin) return
      } catch {
        /* fall through to prevent */
      }
    }
    e.preventDefault()
  })

  // Native right-click menu for editable fields: spellcheck suggestions + edit actions.
  // Electron underlines misspellings automatically but surfaces fixes only via a menu we
  // build here. Restricted to editable targets (and misspellings) so it never collides with
  // the renderer's own context menus (e.g. the sidebar's right-click).
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const wc = mainWindow?.webContents
    if (!wc || !(params.isEditable || params.misspelledWord)) return
    const items: MenuItemConstructorOptions[] = []

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        items.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) })
      }
      if (params.dictionarySuggestions.length === 0) {
        items.push({ label: 'No suggestions', enabled: false })
      }
      items.push(
        { type: 'separator' },
        {
          label: 'Add to Dictionary',
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        },
        { type: 'separator' }
      )
    }

    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      )
    }

    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow! })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * True for hostnames the title fetcher must never touch: localhost aliases and
 * IP literals in loopback / private / link-local ranges (v4 and v6).
 */
function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true

  const checkV4 = (addr: string): boolean | null => {
    const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!m) return null
    const [a, b, c, d] = m.slice(1).map(Number)
    if ([a, b, c, d].some((n) => n > 255)) return null
    return (
      a === 0 || // "this network"
      a === 127 || // loopback
      a === 10 || // private
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 169 && b === 254) // link-local
    )
  }
  const v4 = checkV4(h)
  if (v4 !== null) return v4

  if (h.includes(':')) {
    // IPv6 literal.
    if (h === '::1' || h === '::') return true // loopback / unspecified
    if (h.startsWith('fc') || h.startsWith('fd')) return true // fc00::/7 unique-local
    if (/^fe[89ab]/.test(h)) return true // fe80::/10 link-local
    const mapped = h.match(/^::ffff:(.+)$/) // v4-mapped, e.g. ::ffff:127.0.0.1
    if (mapped) return checkV4(mapped[1]) ?? true
    return false
  }
  return false
}

/**
 * True when a URL must not be fetched: non-http(s), a private hostname literal, or a
 * public-looking name that RESOLVES to a private address (DNS rebinding). Unresolvable
 * hosts are refused too — fail closed.
 */
async function isForbiddenFetchTarget(url: URL): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
  if (isPrivateHostname(url.hostname)) return true
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // An IP literal was already fully vetted by isPrivateHostname — no DNS to check.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false
  try {
    const addrs = await dns.lookup(host, { all: true })
    return addrs.length === 0 || addrs.some((a) => isPrivateHostname(a.address))
  } catch {
    return true
  }
}

/** Read at most `maxBytes` of a fetch response body as text, then cancel the stream. */
async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, maxBytes)
  const decoder = new TextDecoder()
  let out = ''
  let bytes = 0
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      out += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return out
}

const badArgs: WriteResult = { ok: false, error: 'Invalid arguments' }

/** Lightweight IPC argument guards — reject malformed payloads at the boundary. */
const isStr = (v: unknown): v is string => typeof v === 'string'
const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null

function registerIpc(): void {
  ipcMain.handle('workspace:open', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Verso Workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const root = result.filePaths[0]
    const ws = await openWorkspaceAt(root, mainWindow)
    if (ws) {
      await rememberWorkspace(root)
      setIgnoreWords(await readUserDictionary())
    }
    return ws
  })

  ipcMain.handle('workspace:load', async (_e, root: string) => {
    if (!mainWindow || !isStr(root)) return null
    // Only re-open vaults the user has already chosen via the picker. A new vault
    // always comes in through `workspace:open` (the OS dialog), so the renderer can
    // never point the app at an arbitrary path it wasn't granted.
    const prefs = await readPrefs()
    const known = prefs.vaults ?? (prefs.lastWorkspace ? [prefs.lastWorkspace] : [])
    if (!known.includes(root)) return null
    const ws = await openWorkspaceAt(root, mainWindow)
    if (ws) {
      await rememberWorkspace(root)
      setIgnoreWords(await readUserDictionary())
    }
    return ws
  })

  ipcMain.handle('workspace:last', async () => {
    const prefs = await readPrefs()
    return prefs.lastWorkspace ?? prefs.vaults?.[0] ?? null
  })

  // The list of known vaults (most-recent first), for the sidebar switcher.
  ipcMain.handle('workspace:recents', async () => {
    const prefs = await readPrefs()
    return prefs.vaults ?? (prefs.lastWorkspace ? [prefs.lastWorkspace] : [])
  })

  // Drop a vault from the remembered list — never touches the folder on disk.
  ipcMain.handle('workspace:forget', async (_e, root: string) => {
    if (!isStr(root)) return []
    return withPrefs(async () => {
      const prefs = await readPrefs()
      const vaults = (prefs.vaults ?? (prefs.lastWorkspace ? [prefs.lastWorkspace] : [])).filter((v) => v !== root)
      const lastWorkspace = prefs.lastWorkspace === root ? vaults[0] : prefs.lastWorkspace
      await writePrefs({ lastWorkspace, vaults })
      return vaults
    })
  })

  ipcMain.handle('note:read', async (_e, p: string): Promise<NoteContent | null> => {
    if (!isStr(p)) return null
    const text = await readNote(p)
    return text === null ? null : { path: p, text }
  })

  ipcMain.handle('note:readAll', async (): Promise<NoteContent[]> => {
    return readAllNotes()
  })

  ipcMain.handle('note:write', async (_e, p: string, text: string): Promise<WriteResult> => {
    if (!isStr(p) || !isStr(text)) return badArgs
    return writeNote(p, text)
  })

  ipcMain.handle('note:create', async (_e, p: string, text: string) => {
    if (!isStr(p) || !isStr(text)) return null
    return createNote(p, text)
  })

  ipcMain.handle('note:rename', async (_e, oldPath: string, newPath: string) => {
    if (!isStr(oldPath) || !isStr(newPath)) return null
    return renameNote(oldPath, newPath)
  })

  ipcMain.handle('note:delete', async (_e, p: string) => {
    if (!isStr(p)) return false
    return deleteNote(p)
  })

  ipcMain.handle('note:reveal', async (_e, p: string) => {
    if (!isStr(p)) return
    return revealNote(p)
  })

  ipcMain.handle('asset:save', async (_e, filename: string, base64: string) => {
    if (!isStr(filename) || !isStr(base64)) return null
    return saveAsset(filename, base64)
  })

  ipcMain.handle('asset:list', async () => listAssets())

  // Assets are trashed with the same path-guarded primitive as notes (it's not note-specific).
  ipcMain.handle('asset:delete', async (_e, p: string) => (isStr(p) ? deleteNote(p) : false))

  ipcMain.handle('canvas:list', async () => listCanvases())
  ipcMain.handle('canvas:read', async (_e, p: string) => (isStr(p) ? readCanvas(p) : null))
  ipcMain.handle('canvas:write', async (_e, p: string, data): Promise<WriteResult> => {
    if (!isStr(p) || !isObj(data)) return badArgs
    return writeCanvas(p, data)
  })
  ipcMain.handle('canvas:create', async (_e, p: string) => (isStr(p) ? createCanvas(p) : null))
  ipcMain.handle('canvas:rename', async (_e, oldPath: string, newPath: string) =>
    isStr(oldPath) && isStr(newPath) ? renameCanvas(oldPath, newPath) : null
  )
  // Canvases trash with the same path-guarded primitive as notes (not note-specific).
  ipcMain.handle('canvas:delete', async (_e, p: string) => (isStr(p) ? deleteNote(p) : false))

  ipcMain.handle('bases:read', async () => readBases())
  ipcMain.handle('bases:write', async (_e, data): Promise<WriteResult> => {
    if (!isObj(data)) return badArgs
    return writeBases(data)
  })

  ipcMain.handle('css:read', async () => readCustomCss())

  // Fetch a web page's <title> for "smart" link titles on paste. Best-effort: returns
  // null on any failure so the renderer just keeps the bare URL. Public http/https
  // only — local/private hosts are refused so this can't be used to probe the LAN.
  ipcMain.handle('link:title', async (_e, url: string) => {
    if (!isStr(url)) return null
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 6000)
      // Follow redirects by hand so every hop is re-validated — otherwise a public
      // URL could 302 to localhost / a private range and turn this into an SSRF probe.
      let target = parsed
      let res: Response | null = null
      for (let hop = 0; hop < 5; hop++) {
        if (await isForbiddenFetchTarget(target)) {
          clearTimeout(timer)
          return null
        }
        res = await net.fetch(target.href, {
          signal: ctrl.signal,
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 Verso' }
        })
        if (res.status < 300 || res.status >= 400) break
        const loc = res.headers.get('location')
        if (!loc) {
          clearTimeout(timer)
          return null
        }
        target = new URL(loc, target)
        res = null
      }
      clearTimeout(timer)
      if (!res || !res.ok) return null
      const html = await readBodyCapped(res, 256 * 1024)
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      if (!m) return null
      const decode = (s: string): string =>
        s
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#0?39;|&apos;/g, "'")
          .replace(/&#(\d+);/g, (_x, n) => String.fromCodePoint(Number(n)))
      return decode(m[1]).replace(/\s+/g, ' ').trim().slice(0, 300) || null
    } catch {
      return null
    }
  })

  // Spellcheck (the dictionary lives in the main process — see spell.ts).
  ipcMain.handle('spell:check', async (_e, words: string[]) =>
    Array.isArray(words) ? checkWords(words.filter(isStr)) : []
  )
  ipcMain.handle('spell:suggest', async (_e, word: string) => (isStr(word) ? suggestWord(word) : []))
  ipcMain.handle('spell:add', async (_e, word: string) => {
    if (!isStr(word)) return
    addIgnoreWord(word)
    await addUserDictionaryWord(word)
  })
}

/** Apply a CSP: permissive in dev (Vite needs inline/eval/ws), strict in production.
 *  Stamped only onto the app's own responses — never third-party ones, or the policy
 *  would override what embedded pages (YouTube/Vimeo/Loom iframes) need to run. */
function applyCsp(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const policy = devUrl
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: verso: https: ws: http://localhost:*; worker-src 'self' blob:"
    : PROD_CSP
  const devOrigin = ((): string | null => {
    try {
      return devUrl ? new URL(devUrl).origin : null
    } catch {
      return null
    }
  })()
  const isAppUrl = (url: string): boolean => {
    try {
      const u = new URL(url)
      if (u.protocol === 'file:' || u.protocol === 'verso:') return true
      return devOrigin !== null && u.origin === devOrigin
    } catch {
      return false
    }
  }
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!isAppUrl(details.url)) {
      cb({})
      return
    }
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })

  // YouTube's embed player refuses to boot without an HTTP Referer ("Error 153 —
  // video player configuration error"). The packaged app is served from file://,
  // which sends none, so stamp one onto the embed-document requests.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] },
    (details, cb) => {
      cb({ requestHeaders: { ...details.requestHeaders, Referer: 'https://verso.app/' } })
    }
  )
}

/** File types `verso://` may serve — images, pdf, audio, video. Everything else 404s. */
const PROTOCOL_ALLOWED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.pdf',
  '.mp4', '.webm', '.mov',
  '.mp3', '.wav', '.m4a'
])

/** Serve workspace files to the renderer via verso://asset/<relative-path>. */
function registerAssetProtocol(): void {
  protocol.handle('verso', async (request) => {
    try {
      const url = new URL(request.url)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!PROTOCOL_ALLOWED_EXTS.has(path.extname(rel).toLowerCase())) {
        return new Response('Not found', { status: 404 })
      }
      const abs = resolveAsset(rel)
      if (!abs) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

app
  .whenReady()
  .then(async () => {
    await migrateLegacyPrefs()
    applyCsp()
    registerAssetProtocol()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((e) => console.error('[main] startup failed:', e))

app.on('window-all-closed', () => {
  closeWatcher()
  if (process.platform !== 'darwin') app.quit()
})
