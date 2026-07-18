/**
 * Spellchecking lives in the main process so the 550 KB English dictionary loads off
 * the renderer thread and out of its bundle. The renderer asks "are these words
 * misspelled?" over IPC and caches the answers, so the dictionary is built lazily on
 * first use and never touches the typing hot path.
 *
 * The per-vault ignore list ("add to dictionary") is applied at check time rather than
 * baked into the nspell instance, so switching vaults just swaps the set — no rebuild.
 */
interface NSpell {
  correct(word: string): boolean
  suggest(word: string): string[]
  add(word: string): NSpell
}

let loading: Promise<NSpell | null> | null = null
/** Lowercased words the user has chosen to ignore in the current vault. */
let ignore = new Set<string>()

/** Common words the bundled dictionary lacks: PKM/app vocabulary plus transliterated
 *  Arabic that recurs throughout the vault. Extend freely — one word per entry. */
const EXTRA_WORDS = [
  // notes-app vocabulary
  'todo', 'todos', 'backlink', 'backlinks', 'wikilink', 'wikilinks', 'frontmatter',
  'supertag', 'supertags', 'journaling', 'favicon', 'favicons', 'dropdown', 'dropdowns',
  'tooltip', 'tooltips', 'unlinked', 'uncategorized', 'searchable', 'clickable',
  'Logseq', 'Verso', 'Nextcloud', 'Excalidraw',
  // Gulf / Arabic-learning vocabulary (transliterations)
  'Emirati', 'Khaleeji', 'marhaba', 'ahlan', 'shukran', 'mashkoor', 'mabrook',
  'mumtaz', 'yalla', 'habibi', 'inshallah', 'khalas', 'hamza'
]

/** Build the nspell instance once, lazily. Dynamic import keeps the ESM-only
 *  `dictionary-en` (and its file reads) out of startup. */
function load(): Promise<NSpell | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const [dictMod, nspellMod] = await Promise.all([
          import('dictionary-en'),
          import('nspell')
        ])
        const nspell = (nspellMod.default ?? nspellMod) as (d: unknown) => NSpell
        const spell = nspell(dictMod.default)
        for (const w of EXTRA_WORDS) spell.add(w)
        return spell
      } catch (e) {
        console.error('[spell] failed to load dictionary', e)
        return null
      }
    })()
  }
  return loading
}

/** Return the subset of `words` that are misspelled (ignored words count as correct).
 *  The renderer lowercases words before asking (its cache is case-insensitive), but
 *  hunspell proper nouns are case-sensitive — "monday" fails while "Monday" passes —
 *  so a word also counts as correct when its title-cased form is. */
export async function checkWords(words: string[]): Promise<string[]> {
  const spell = await load()
  if (!spell) return []
  const bad: string[] = []
  for (const w of words) {
    if (ignore.has(w.toLowerCase())) continue
    if (spell.correct(w)) continue
    if (w[0] && spell.correct(w[0].toUpperCase() + w.slice(1))) continue
    bad.push(w)
  }
  return bad
}

/** Up to 8 correction suggestions for a misspelled word. */
export async function suggestWord(word: string): Promise<string[]> {
  const spell = await load()
  if (!spell) return []
  return spell.suggest(word).slice(0, 8)
}

/** Replace the ignore set (on vault open). */
export function setIgnoreWords(words: string[]): void {
  ignore = new Set(words.map((w) => w.toLowerCase()))
}

/** Add one word to the ignore set (on "add to dictionary"). */
export function addIgnoreWord(word: string): void {
  ignore.add(word.toLowerCase())
}
