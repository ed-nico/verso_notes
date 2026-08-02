import { useSyncExternalStore } from 'react'
import type { Block } from './blocks'

/**
 * The formatting toolbar's handle on whichever editor currently has the caret.
 *
 * The journal stacks one BlockEditor per day, so the bar can't live inside them
 * — you'd get one per day. It's lifted to the top of the page instead, and the
 * focused editor publishes its handlers here. Same pub/sub role as notebus /
 * pdfbus: cross-component wiring the store has no business owning, because none
 * of this is document state.
 *
 * Exactly one editor is ever published: publishing is driven by focus, and an
 * editor clears the slot on blur only if it still owns it (a click that moves
 * focus between two editors fires the new one's set before the old one's clear).
 */
export interface Formatter {
  /** Identity of the publishing editor, so a stale blur can't clear a live one. */
  owner: symbol
  /** Wrap the selection in `open`/`close` (close defaults to open). */
  applyInline: (open: string, close?: string) => void
  setBlockKind: (kind: 1 | 2 | 3 | 'bullet' | 'ordered' | 'task' | 'quote') => void
  /** The focused block, for the toolbar's pressed states; null when nothing is. */
  block: Block | null
}

let current: Formatter | null = null
const subs = new Set<() => void>()

const emit = (): void => subs.forEach((s) => s())

export function setFormatter(f: Formatter): void {
  current = f
  emit()
}

/** Clear the slot, but only if `owner` still holds it. */
export function clearFormatter(owner: symbol): void {
  if (current?.owner !== owner) return
  current = null
  emit()
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useFormatter(): Formatter | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}
