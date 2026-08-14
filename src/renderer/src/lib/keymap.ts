/**
 * The app-level keyboard shortcuts, in one table.
 *
 * These used to live in three places that could disagree: the window keydown
 * handler in App.tsx, the editor's own handler, and the Help sheet's hand-written
 * rows. Adding a binding meant guessing whether it was already taken — ⌘⇧F was
 * already the editor's find, ⌘⇧Z already redo, and both were discovered only by
 * trying them. This table is the list to check, and `keymap.test.ts` fails the
 * build if two entries in the same scope claim the same chord.
 *
 * It is documentation plus a conflict test, deliberately NOT a dispatcher: the
 * handlers stay where the state they need lives. Adding a binding means adding it
 * here too, and the test is what makes that hard to forget — a chord that already
 * exists can't be added twice.
 */

/** Where a chord is listened for. The same chord in different scopes is fine —
 *  the editor's handler runs first and stops the window one seeing it. */
export type KeyScope = 'global' | 'editor'

export interface KeyBinding {
  /** Display form, e.g. `⌘⇧T`. Modifier order is ⌘ ⌥ ⇧ throughout. */
  keys: string
  /** What it does, phrased for the Help sheet. */
  label: string
  scope: KeyScope
  /** Grouping in Help. */
  group: 'Navigate' | 'Panels' | 'Notes' | 'Editing' | 'Capture'
}

export const KEYMAP: KeyBinding[] = [
  { keys: '⌘K', label: 'Command palette — any note, any command', scope: 'global', group: 'Navigate' },
  { keys: '⌘P', label: 'Command palette (same as ⌘K)', scope: 'global', group: 'Navigate' },
  { keys: '⌘D', label: 'Jump to today’s daily note', scope: 'global', group: 'Navigate' },
  { keys: '⌘[', label: 'Back', scope: 'global', group: 'Navigate' },
  { keys: '⌘]', label: 'Forward', scope: 'global', group: 'Navigate' },

  { keys: '⌘\\', label: 'Show/hide the sidebar', scope: 'global', group: 'Panels' },
  { keys: '⌘⇧\\', label: 'Show/hide the right panel', scope: 'global', group: 'Panels' },
  { keys: '⌘⌥\\', label: 'Zen mode — the note and nothing else', scope: 'global', group: 'Panels' },
  { keys: '⌘W', label: 'Close the rightmost split pane', scope: 'global', group: 'Panels' },

  { keys: '⌘N', label: 'New note', scope: 'global', group: 'Notes' },
  { keys: '⌘S', label: 'Flush pending writes (edits already save themselves)', scope: 'global', group: 'Notes' },

  { keys: '⌘⇧T', label: 'Quick capture — add a task to today', scope: 'global', group: 'Capture' },

  { keys: '⌘B', label: 'Bold', scope: 'editor', group: 'Editing' },
  { keys: '⌘I', label: 'Italic', scope: 'editor', group: 'Editing' },
  { keys: '⌘E', label: 'Inline code', scope: 'editor', group: 'Editing' },
  { keys: '⌘F', label: 'Find & replace in this note', scope: 'editor', group: 'Editing' },
  { keys: '⌘⇧F', label: 'Find & replace in this note', scope: 'editor', group: 'Editing' },
  { keys: '⌘↵', label: 'Cycle the line: text → ☐ → ☑', scope: 'editor', group: 'Editing' },
  { keys: '⌘Z', label: 'Undo (word-level)', scope: 'editor', group: 'Editing' },
  { keys: '⌘⇧Z', label: 'Redo', scope: 'editor', group: 'Editing' },
  { keys: 'Tab', label: 'Indent the block', scope: 'editor', group: 'Editing' },
  { keys: '⇧Tab', label: 'Outdent the block', scope: 'editor', group: 'Editing' }
]

/** Chords bound more than once within a scope. Empty is the only healthy answer;
 *  `keymap.test.ts` asserts it. */
export function keyConflicts(map: KeyBinding[] = KEYMAP): string[] {
  const seen = new Map<string, number>()
  for (const b of map) {
    const k = `${b.scope}:${b.keys}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  // ⌘F and ⌘⇧F both opening find is intentional (two habits, one panel), so a
  // conflict is a chord appearing twice with DIFFERENT labels.
  const byChord = new Map<string, Set<string>>()
  for (const b of map) {
    const k = `${b.scope}:${b.keys}`
    const set = byChord.get(k) ?? new Set<string>()
    set.add(b.label)
    byChord.set(k, set)
  }
  return [...byChord.entries()].filter(([, labels]) => labels.size > 1).map(([k]) => k)
}
