/**
 * Renderer-side spellcheck cache. The dictionary lives in the main process; this asks
 * "are these words misspelled?" over IPC and remembers the answers, so each distinct
 * word is checked once and rendering stays synchronous. Unknown words are queued,
 * checked in a batched async pass, and subscribers re-render when the results land.
 *
 * Spellcheck never runs on the block you're typing in (that's a native <textarea>) — only
 * on the rendered, non-focused blocks — so there's no per-keystroke cost.
 */

const cache = new Map<string, boolean>() // word (lowercased) -> misspelled?
const queue = new Set<string>() // words awaiting a check
const inflight = new Set<string>() // words currently being checked
const subs = new Set<() => void>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const MIN_LEN = 3
// Worth checking: letters + internal apostrophes only. Skips numbers, code-ish tokens,
// and ALL-CAPS acronyms (which a dictionary flags as noise).
const WORD_RE = /^[A-Za-z][A-Za-z']*$/
// An internal capital after a lowercase letter means an identifier, not prose:
// `useState`, `readNotes`, `iPhone`. A dictionary has nothing useful to say about
// these and flagging them is the fastest way to make people switch spellcheck off.
const CAMEL_RE = /[a-z][A-Z]/

/**
 * Words the VAULT already knows: every note name, alias and tag, split into
 * tokens. A personal vault is full of proper nouns no dictionary carries — place
 * names, people, projects, transliterations — and the user has already told us
 * they're words by naming notes after them. This is what stops a PKM app
 * underlining half of someone's own vocabulary.
 */
let vaultWords = new Set<string>()

/** Replace the vault vocabulary (on index rebuild / vault switch). */
export function setVaultWords(words: Iterable<string>): void {
  const next = new Set<string>()
  for (const w of words) {
    for (const tok of w.split(/[^A-Za-z']+/)) {
      if (tok.length >= MIN_LEN) next.add(tok.toLowerCase())
    }
  }
  // Only bust the cache when the vocabulary actually changed — this runs on every
  // index rebuild, and a needless reset re-checks the whole visible note.
  if (next.size === vaultWords.size && [...next].every((w) => vaultWords.has(w))) return
  vaultWords = next
  for (const [w, bad] of cache) if (bad && vaultWords.has(w)) cache.delete(w)
  notify()
}

export function spellable(word: string): boolean {
  if (word.length < MIN_LEN || !WORD_RE.test(word)) return false
  if (/^[A-Z]+$/.test(word)) return false // acronym
  if (CAMEL_RE.test(word)) return false // identifier
  return !vaultWords.has(word.toLowerCase())
}

/** Synchronous status: true = misspelled, false = ok, undefined = not checked yet
 *  (queues an async check as a side effect). */
export function spellStatus(word: string): boolean | undefined {
  if (!spellable(word)) return false
  const key = word.toLowerCase()
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  if (!inflight.has(key)) {
    queue.add(key)
    schedule()
  }
  return undefined
}

function schedule(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => void flush(), 150)
}

async function flush(): Promise<void> {
  flushTimer = null
  if (!queue.size) return
  const words = [...queue]
  queue.clear()
  for (const w of words) inflight.add(w)
  let bad: string[] = []
  try {
    bad = await window.verso.checkSpelling(words)
  } catch {
    /* on failure, treat all as correct so we never underline the whole note */
  }
  const badSet = new Set(bad.map((w) => w.toLowerCase()))
  for (const w of words) {
    cache.set(w, badSet.has(w))
    inflight.delete(w)
  }
  notify()
}

function notify(): void {
  for (const cb of subs) cb()
}

/** Re-render hook: called when a batch of check results arrives. */
export function subscribeSpell(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

/** Forget cached results (on vault switch, or after ignoring a word) so they re-check. */
export function resetSpell(): void {
  cache.clear()
  queue.clear()
  inflight.clear()
  notify()
}
