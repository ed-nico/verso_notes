#!/usr/bin/env node
/**
 * Generate a large synthetic Verso vault for stress-testing.
 *
 *   node scripts/gen-test-vault.mjs [outDir] [noteCount]
 *
 * Defaults: outDir=./test-vault, noteCount=50000.
 * Creates plain-Markdown notes with frontmatter properties, [[wikilinks]] (→ backlinks),
 * todos with due dates, inline #tags, a couple of years of Daily/ journal notes, two
 * supertags (Person, Book) with hundreds of typed entities, and a few prebuilt Bases
 * (including a Kanban board). Everything lives under one folder so you can delete it freely.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const OUT = process.argv[2] || './test-vault'
const TOTAL = Number(process.argv[3]) || 50000
const NOTE_FOLDERS = 50 // spread notes so no single dir holds 50k files
const DAILY_DAYS = 730 // ~2 years of journal notes
const PEOPLE = 600
const BOOKS = 600

// ---- tiny seeded PRNG (deterministic re-runs) ----
let seed = 0x9e3779b9
const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const pad = (n, w = 5) => String(n).padStart(w, '0')

const WORDS =
  'system note idea project plan review meeting design data model graph query index cache vault link tag todo task draft outline summary research concept theory method result analysis pattern signal vector matrix kernel buffer stream token parser render layout schema entity field record value metric trace sample window debounce backlink journal daily insight sketch memo brief'.split(
    ' '
  )
const TAGS = [
  'idea', 'project', 'research', 'work', 'personal', 'reading', 'meeting', 'todo',
  'reference', 'draft', 'archive', 'inbox', 'review', 'design', 'data', 'finance',
  'health', 'travel', 'recipe', 'quote'
]
const STATUSES = ['To Read', 'Reading', 'Done']
const ROLES = ['Engineer', 'Designer', 'Adjuster', 'Founder', 'Analyst', 'Writer', 'Manager']
const COMPANIES = ['LWI', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark']

const sentence = (n) =>
  Array.from({ length: n }, () => pick(WORDS)).join(' ').replace(/^./, (c) => c.toUpperCase()) + '.'
const para = () => Array.from({ length: int(2, 5) }, () => sentence(int(6, 14))).join(' ')

/** YAML scalar — JSON.stringify gives a safe double-quoted string; numbers/bools raw. */
const y = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return '[' + v.map((x) => JSON.stringify(String(x))).join(', ') + ']'
  return JSON.stringify(String(v))
}
const fm = (obj) =>
  '---\n' + Object.entries(obj).map(([k, v]) => `${k}: ${y(v)}`).join('\n') + '\n---\n\n'

const noteName = (i) => `Note ${pad(i)}`
const linkTo = (i) => `[[${noteName(i)}]]`
const dueDate = () => {
  const m = pad(int(1, 12), 2)
  const d = pad(int(1, 28), 2)
  return `2026-${m}-${d}`
}

// Batched writer so 50k files don't exhaust file handles.
let written = 0
let batch = []
const flush = async () => {
  await Promise.all(batch.map(([p, c]) => writeFile(p, c)))
  written += batch.length
  batch = []
  if (written % 5000 === 0) console.log(`  … ${written} files`)
}
const emit = async (rel, content) => {
  batch.push([path.join(OUT, rel), content])
  if (batch.length >= 2000) await flush()
}

async function main() {
  if (existsSync(OUT)) {
    console.log(`Removing existing ${OUT} …`)
    await rm(OUT, { recursive: true, force: true })
  }
  // Pre-create all directories.
  const dirs = new Set([OUT, path.join(OUT, '.verso'), path.join(OUT, 'Tags'), path.join(OUT, 'People'), path.join(OUT, 'Books')])
  for (let f = 0; f < NOTE_FOLDERS; f++) dirs.add(path.join(OUT, 'Notes', `Folder ${pad(f + 1, 2)}`))
  // Daily/YYYY/MM month folders across the journal date range.
  const dStart = new Date(2024, 0, 1)
  for (let d = 0; d < DAILY_DAYS; d++) {
    const dt = new Date(dStart)
    dt.setDate(dStart.getDate() + d)
    dirs.add(path.join(OUT, 'Daily', String(dt.getFullYear()), pad(dt.getMonth() + 1, 2)))
  }
  for (const d of dirs) await mkdir(d, { recursive: true })

  console.log(`Generating ~${TOTAL} notes into ${OUT} …`)

  // ---- regular notes ----
  for (let i = 1; i <= TOTAL; i++) {
    const folder = `Folder ${pad((i % NOTE_FOLDERS) + 1, 2)}`
    const tags = Array.from({ length: int(1, 3) }, () => pick(TAGS))
    const props = {
      created: `2025-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`,
      tags: [...new Set(tags)],
      rating: int(1, 10),
      status: pick(STATUSES)
    }
    const links = Array.from({ length: int(2, 6) }, () => int(1, TOTAL)).filter((x) => x !== i)
    const todos = Array.from({ length: int(0, 3) }, () =>
      `- [${rnd() < 0.4 ? 'x' : ' '}] ${sentence(int(3, 7))} @${dueDate()}`
    )
    const body =
      `# ${noteName(i)}\n\n` +
      `${para()}\n\n` +
      `Related: ${links.map(linkTo).join(', ')} #${pick(TAGS)}\n\n` +
      (todos.length ? todos.join('\n') + '\n\n' : '') +
      `${para()}\n`
    await emit(path.join('Notes', folder, `${noteName(i)}.md`), fm(props) + body)
  }

  // ---- supertag definitions ----
  await emit(
    'Tags/Person.md',
    '---\nfields:\n  role: text\n  company: text\n  email: text\n  website: url\n---\n\n# Person\n\nTag a note with `#person` to make it a Person entity.\n'
  )
  await emit(
    'Tags/Book.md',
    '---\nfields:\n  author: link\n  rating: number\n  status: { type: select, options: [To Read, Reading, Done] }\n  started: date\n  link: url\n---\n\n# Book\n\nTag a note with `#book` to make it a Book entity.\n'
  )

  // ---- People entities (tagged person, with fields + cross-links) ----
  for (let i = 1; i <= PEOPLE; i++) {
    const name = `Person ${pad(i, 4)}`
    const friends = Array.from({ length: int(1, 4) }, () => int(1, PEOPLE)).filter((x) => x !== i)
    const props = {
      tags: ['person'],
      role: pick(ROLES),
      company: pick(COMPANIES),
      email: `person${pad(i, 4)}@example.com`,
      website: `https://example.com/${pad(i, 4)}`
    }
    const body =
      `# ${name}\n\n${sentence(12)}\n\nKnows: ${friends.map((f) => `[[Person ${pad(f, 4)}]]`).join(', ')}\n\n` +
      `- [ ] Follow up with ${name} @${dueDate()}\n`
    await emit(path.join('People', `${name}.md`), fm(props) + body)
  }

  // ---- Books entities (tagged book, status for the Kanban board) ----
  for (let i = 1; i <= BOOKS; i++) {
    const name = `Book ${pad(i, 4)}`
    const props = {
      tags: ['book'],
      author: `[[Person ${pad(int(1, PEOPLE), 4)}]]`,
      rating: int(1, 5),
      status: pick(STATUSES),
      started: `2025-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`,
      link: `https://books.example.com/${pad(i, 4)}`
    }
    await emit(path.join('Books', `${name}.md`), fm(props) + `# ${name}\n\n${para()}\n`)
  }

  // ---- Daily journal notes (Daily/YYYY/MM/YYYY-MM-DD.md) ----
  const start = new Date(2024, 0, 1)
  for (let d = 0; d < DAILY_DAYS; d++) {
    const dt = new Date(start)
    dt.setDate(start.getDate() + d)
    const iso = `${dt.getFullYear()}-${pad(dt.getMonth() + 1, 2)}-${pad(dt.getDate(), 2)}`
    const links = Array.from({ length: int(1, 4) }, () => int(1, TOTAL))
    const body =
      `# ${iso}\n\n` +
      `- [${rnd() < 0.5 ? 'x' : ' '}] ${sentence(int(3, 7))}\n` +
      `- [ ] ${sentence(int(3, 7))} @${dueDate()}\n\n` +
      `Notes: ${links.map(linkTo).join(', ')}\n\n${sentence(10)}\n`
    await emit(`Daily/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso}.md`, fm({ tags: ['journal'] }) + body)
  }

  // ---- prebuilt Bases (incl. a Kanban board over Books by status) ----
  const bases = [
    {
      id: 'allnotes', name: 'All Notes', folder: 'Notes', tag: '', filters: [],
      columns: ['name', 'status', 'rating', 'tags', 'backlinks'],
      groupKey: '', aggregates: { rating: 'avg' }, sortKey: 'name', sortDir: 'asc', layout: 'table'
    },
    {
      id: 'booksboard', name: 'Books', folder: 'Books', tag: 'book', filters: [],
      columns: ['name', 'author', 'rating', 'status'],
      groupKey: 'status', aggregates: {}, sortKey: 'name', sortDir: 'asc', layout: 'board'
    },
    {
      id: 'people', name: 'People', folder: 'People', tag: 'person', filters: [],
      columns: ['name', 'role', 'company', 'backlinks'],
      groupKey: 'company', aggregates: {}, sortKey: 'name', sortDir: 'asc', layout: 'gallery'
    }
  ]
  await emit('.verso/bases.json', JSON.stringify(bases, null, 2))

  await flush()
  console.log(`\nDone. ${written} files written to ${OUT}`)
  console.log('Point Verso at that folder (Open Workspace) to stress-test.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
