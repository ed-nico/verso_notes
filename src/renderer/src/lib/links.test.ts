import { describe, it, expect } from 'vitest'
import {
  basename,
  dirname,
  parseTarget,
  pathForNewNote,
  resolvePage,
  resolveTarget,
  rewriteLinks,
  stripMd
} from './links'

describe('stripMd', () => {
  it('strips .md case-insensitively', () => {
    expect(stripMd('a.md')).toBe('a')
    expect(stripMd('a.MD')).toBe('a')
    expect(stripMd('Folder/a.md')).toBe('Folder/a')
  })
  it('leaves non-.md untouched', () => {
    expect(stripMd('note')).toBe('note')
    expect(stripMd('a.markdown')).toBe('a.markdown')
  })
})

describe('basename / dirname', () => {
  it('basename drops folder and extension', () => {
    expect(basename('Folder/Sub/Note.md')).toBe('Note')
    expect(basename('Note.md')).toBe('Note')
  })
  it('dirname returns the folder or empty', () => {
    expect(dirname('Folder/Note.md')).toBe('Folder')
    expect(dirname('Note.md')).toBe('')
  })
})

describe('parseTarget', () => {
  it('strips heading and block suffixes', () => {
    expect(parseTarget('Note#heading').page).toBe('Note')
    expect(parseTarget('Note^blockid').page).toBe('Note')
    expect(parseTarget('Folder/Note.md').page).toBe('Folder/Note')
  })
})

describe('resolvePage', () => {
  const paths = ['Note.md', 'Folder/Note.md', 'Folder/Other.md']
  it('prefers an exact-case basename, shortest path on ties', () => {
    expect(resolvePage('Note', paths)).toBe('Note.md')
  })
  it('falls back to case-insensitive match', () => {
    expect(resolvePage('note', ['Folder/Note.md'])).toBe('Folder/Note.md')
  })
  it('treats a slashed page as a full path', () => {
    expect(resolvePage('Folder/Note', paths)).toBe('Folder/Note.md')
  })
  it('returns null for empty or missing', () => {
    expect(resolvePage('', paths)).toBeNull()
    expect(resolvePage('Missing', paths)).toBeNull()
  })
})

describe('resolveTarget', () => {
  it('resolves a link with a heading suffix', () => {
    expect(resolveTarget('Note#sec', ['Note.md'])).toBe('Note.md')
  })
})

describe('pathForNewNote', () => {
  it('appends .md when absent', () => {
    expect(pathForNewNote('Foo')).toBe('Foo.md')
    expect(pathForNewNote('Foo.md')).toBe('Foo.md')
  })
})

describe('rewriteLinks', () => {
  it('rewrites a bare link, preserving alias and heading', () => {
    const paths = ['Old.md']
    expect(rewriteLinks('[[Old]]', 'Old.md', 'New.md', paths)).toBe('[[New]]')
    expect(rewriteLinks('[[Old|label]]', 'Old.md', 'New.md', paths)).toBe('[[New|label]]')
    expect(rewriteLinks('[[Old#sec]]', 'Old.md', 'New.md', paths)).toBe('[[New#sec]]')
  })
  it('rewrites a full-path link keeping the folder', () => {
    expect(rewriteLinks('[[Folder/Old]]', 'Folder/Old.md', 'Folder/New.md', ['Folder/Old.md'])).toBe(
      '[[Folder/New]]'
    )
  })
  it('leaves non-matching links alone', () => {
    expect(rewriteLinks('[[Other]]', 'Old.md', 'New.md', ['Old.md', 'Other.md'])).toBe('[[Other]]')
  })

  it('does not rewrite links inside fenced code blocks', () => {
    const text = '```\n[[Old]]\n```\n[[Old]]'
    expect(rewriteLinks(text, 'Old.md', 'New.md', ['Old.md'])).toBe('```\n[[Old]]\n```\n[[New]]')
  })

  it('does not rewrite links inside ~~~ fences', () => {
    const text = '~~~\n[[Old]]\n~~~\n[[Old]]'
    expect(rewriteLinks(text, 'Old.md', 'New.md', ['Old.md'])).toBe('~~~\n[[Old]]\n~~~\n[[New]]')
  })

  it('does not rewrite links inside inline code', () => {
    const text = 'use `[[Old]]` to link [[Old]]'
    expect(rewriteLinks(text, 'Old.md', 'New.md', ['Old.md'])).toBe('use `[[Old]]` to link [[New]]')
  })

  it('does not rewrite inside an unclosed fence', () => {
    const text = '[[Old]]\n```\n[[Old]] never closed'
    expect(rewriteLinks(text, 'Old.md', 'New.md', ['Old.md'])).toBe('[[New]]\n```\n[[Old]] never closed')
  })
})
