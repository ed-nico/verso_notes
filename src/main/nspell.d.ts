declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): NSpell
  }
  /** Accepts a hunspell dictionary `{ aff, dic }` (buffers) — what `dictionary-en` exports. */
  export default function nspell(dictionary: unknown): NSpell
}
