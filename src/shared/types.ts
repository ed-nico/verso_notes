/** Types shared between the main and renderer processes. */

/** A markdown note file in the workspace. */
export interface NoteFile {
  /** Path relative to the workspace root, using "/" separators, without leading slash. e.g. "Projects/Alpha.md" */
  path: string
  /** Display name = filename without the .md extension. */
  name: string
  /** Last modified time, ms since epoch. */
  mtime: number
}

/** A note's full content as read from disk. */
export interface NoteContent {
  path: string
  /** Raw file contents including frontmatter. */
  text: string
}

/** A wikilink occurrence found inside a note. */
export interface LinkRef {
  /** The workspace-relative target path the link resolves to (with .md), or null if unresolved. */
  target: string | null
  /** The raw link target as written, e.g. "Projects/Alpha". */
  raw: string
  /** Optional alias text after the pipe: [[target|alias]]. */
  alias?: string
  /** When the link came from a frontmatter property (a typed relationship), the
   *  property key it was declared under — e.g. `author`. Body links omit this. */
  prop?: string
}

/** Parsed representation of a single note. */
export interface ParsedNote {
  path: string
  name: string
  frontmatter: Record<string, unknown>
  /** Outgoing wikilinks. */
  links: LinkRef[]
  /** Alternate names from frontmatter `aliases:` that `[[wikilinks]]` may resolve to. */
  aliases: string[]
  /** #tags found in the body. */
  tags: string[]
  /** First non-empty, non-heading line — used for previews. */
  excerpt: string
}

/** A non-markdown asset file in the workspace (image, pdf, video, …). */
export interface AssetFile {
  /** Workspace-relative path, e.g. "assets/cover.png". */
  path: string
  /** Filename including extension. */
  name: string
  /** Lowercase extension without the dot, e.g. "png". */
  ext: string
  /** Size in bytes. */
  size: number
  /** Creation time (ms since epoch), falling back to mtime. */
  added: number
}

/** A spatial canvas (`.canvas`) file in the workspace — Obsidian-compatible JSON. */
export interface CanvasMeta {
  /** Workspace-relative path, e.g. "Boards/Roadmap.canvas". */
  path: string
  /** Display name = filename without the .canvas extension. */
  name: string
  /** Last modified time, ms since epoch. */
  mtime: number
}

/** A note template stored under the workspace `.templates/` folder. */
export interface TemplateFile {
  /** Workspace-relative path, e.g. ".templates/Meeting.md". */
  path: string
  /** Display name = filename without the .md extension. */
  name: string
}

/** The result of opening a workspace. */
export interface Workspace {
  root: string
  files: NoteFile[]
}

/** Result of a disk write: `ok: true`, or `ok: false` with a human-readable error. */
export type WriteResult = { ok: true } | { ok: false; error: string }

/** Events pushed from main -> renderer when files change on disk. */
export type FileEvent =
  | { type: 'add' | 'change'; file: NoteFile }
  | { type: 'unlink'; path: string }
  /** A detected move: an unlink of `oldPath` paired with an add of `path` (same basename).
   *  `file` carries the new file's stat when it could be read. */
  | { type: 'rename'; path: string; oldPath: string; file?: NoteFile }

/** API exposed to the renderer via the preload contextBridge. */
export interface InkwellApi {
  /** `process.platform` ('darwin' | 'win32' | 'linux' | …) — for platform-specific labels. */
  platform: string
  openWorkspace: () => Promise<Workspace | null>
  /** Re-open a previously chosen workspace by path (e.g. on startup). */
  loadWorkspace: (root: string) => Promise<Workspace | null>
  readNote: (path: string) => Promise<NoteContent | null>
  /** Read every note in the workspace at once (used to build the link index). */
  readAll: () => Promise<NoteContent[]>
  writeNote: (path: string, text: string) => Promise<WriteResult>
  createNote: (path: string, text: string) => Promise<NoteFile | null>
  /** Move/rename a note on disk. Returns the new file, or null on failure (e.g. target exists). */
  renameNote: (oldPath: string, newPath: string) => Promise<NoteFile | null>
  /** Send a note to the OS trash (recoverable). */
  deleteNote: (path: string) => Promise<boolean>
  /** Reveal a note in the system file manager. */
  revealNote: (path: string) => Promise<void>
  /** Save a binary asset (base64) into the workspace `assets/` folder; returns its relative path. */
  saveAsset: (filename: string, dataBase64: string) => Promise<string | null>
  /** List every non-markdown asset (image/pdf/video/…) in the workspace. */
  listAssets: () => Promise<AssetFile[]>
  /** Send an asset file to the OS trash (recoverable). Used to remove unused assets. */
  deleteAsset: (path: string) => Promise<boolean>
  /** List every spatial canvas (`.canvas`) file in the workspace, most-recent first. */
  listCanvases: () => Promise<CanvasMeta[]>
  /** Read a canvas file's raw JSON (`{ nodes, edges }`), or null if missing/unreadable. */
  readCanvas: (path: string) => Promise<unknown>
  /** Write a canvas file's JSON. */
  writeCanvas: (path: string, data: unknown) => Promise<WriteResult>
  /** Create a new empty canvas at `path` (won't clobber an existing file). */
  createCanvas: (path: string) => Promise<CanvasMeta | null>
  /** Rename/move a canvas file. Returns the new meta, or null on failure. */
  renameCanvas: (oldPath: string, newPath: string) => Promise<CanvasMeta | null>
  /** Send a canvas file to the OS trash (recoverable). */
  deleteCanvas: (path: string) => Promise<boolean>
  /** Read saved Bases from the workspace (`.verso/bases.json`), or null if none. */
  readBases: () => Promise<unknown>
  /** Write saved Bases into the workspace (`.verso/bases.json`). */
  writeBases: (data: unknown) => Promise<WriteResult>
  /** Read the vault's custom stylesheet (`.verso/custom.css`), or null if missing / no workspace. */
  readCustomCss: () => Promise<string | null>
  getLastWorkspace: () => Promise<string | null>
  /** All vaults the user has opened, most-recent first (for the sidebar switcher). */
  getWorkspaces: () => Promise<string[]>
  /** Forget a vault path from the remembered list. Returns the remaining list. Never deletes files. */
  forgetWorkspace: (root: string) => Promise<string[]>
  /** Fetch a web page's title for smart link titles, or null on failure. */
  fetchTitle: (url: string) => Promise<string | null>
  /** Return the subset of `words` that are misspelled (per-vault ignore list applied). */
  checkSpelling: (words: string[]) => Promise<string[]>
  /** Up to 8 correction suggestions for a misspelled word. */
  suggestSpelling: (word: string) => Promise<string[]>
  /** Add a word to the current vault's spellcheck ignore list. */
  addToDictionary: (word: string) => Promise<void>
  onFileEvent: (cb: (event: FileEvent) => void) => () => void
}
