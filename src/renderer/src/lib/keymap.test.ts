import { describe, it, expect } from 'vitest'
import { KEYMAP, keyConflicts, type KeyBinding } from './keymap'

describe('keymap', () => {
  it('binds no chord to two different actions in the same scope', () => {
    // The point of the table: a new binding that collides fails here rather than
    // being discovered by pressing it and watching the wrong thing happen.
    expect(keyConflicts()).toEqual([])
  })

  it('reports a genuine collision', () => {
    const bad: KeyBinding[] = [
      { keys: '⌘J', label: 'Do one thing', scope: 'global', group: 'Navigate' },
      { keys: '⌘J', label: 'Do another thing', scope: 'global', group: 'Navigate' }
    ]
    expect(keyConflicts(bad)).toEqual(['global:⌘J'])
  })

  it('allows the same chord in different scopes', () => {
    const ok: KeyBinding[] = [
      { keys: '⌘J', label: 'Global thing', scope: 'global', group: 'Navigate' },
      { keys: '⌘J', label: 'Editor thing', scope: 'editor', group: 'Editing' }
    ]
    expect(keyConflicts(ok)).toEqual([])
  })

  it('writes modifiers in a consistent order', () => {
    // ⌘ then ⌥ then ⇧ — mixed order in a reference sheet reads as two different keys.
    for (const b of KEYMAP) {
      expect(b.keys).not.toMatch(/⇧⌘|⌥⌘|⇧⌥/)
    }
  })
})
