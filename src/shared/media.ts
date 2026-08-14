/**
 * The one list of media types the app handles, shared by both processes.
 *
 * This knowledge used to live in three places that drifted apart: the main
 * process's watcher/protocol allow-list, `vault.ts`'s "this link is an asset
 * embed, not a phantom note" filter, and `tend.ts`'s copy of the same filter
 * (whose comment even said it mirrored vault.ts). Adding a format now means
 * editing exactly one array.
 */

/** Media extensions, without the leading dot, lowercased. */
export const MEDIA_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'mp4', 'webm', 'mov',
  'mp3', 'wav', 'm4a',
  'pdf'
] as const

/** Dotted form (`.png`, …) for `path.extname()` comparisons in the main process. */
export const MEDIA_EXT_SET: ReadonlySet<string> = new Set(MEDIA_EXTS.map((e) => `.${e}`))

/**
 * A link target that names a FILE rather than a note — `![[photo.png]]`,
 * `[[deck.pdf]]`, `[[Board.canvas]]`. These can never resolve to a note, so
 * they must not become phantom graph nodes or "broken link" reports.
 */
export const FILE_LINK_RE = new RegExp(`\\.(${[...MEDIA_EXTS, 'canvas'].join('|')})$`, 'i')
