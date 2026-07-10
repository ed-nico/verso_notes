/**
 * Vault-wide todo extraction. A todo is any Markdown task line (`- [ ]` / `- [x]`).
 * Its "date" is resolved as: an explicit inline due date (`@2026-06-20`, `📅 …`,
 * or `due:…`), else the note's frontmatter `date`, else the day of a daily note.
 */
import { parseFrontmatter } from './frontmatter'
import { dailyDateOf } from './dates'

export interface Todo {
  id: string
  sourcePath: string
  sourceName: string
  /** Cleaned text (due token stripped). */
  text: string
  checked: boolean
  /** Explicit/derived date this todo is scheduled for, or null. */
  date: string | null
  /** Whether `date` came from an explicit inline due token (vs. the note's day). */
  explicit: boolean
  line: number
}

const TASK_RE = /^(\s*)- \[([ xX])\]\s+(.*)$/
const DUE_RE = /(?:@|📅\s?|due:)(\d{4}-\d{2}-\d{2})/

function nameOf(path: string): string {
  return path.replace(/\.md$/i, '').split('/').pop() ?? path
}

function extractTodos(path: string, text: string): Todo[] {
  const { data, body, bodyLine } = parseFrontmatter(text)
  const fmDate = typeof data.date === 'string' ? data.date : null
  const journalDate = dailyDateOf(path)
  const out: Todo[] = []
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_RE)
    if (!m) continue
    const checked = m[2].toLowerCase() === 'x'
    let content = m[3]
    const due = content.match(DUE_RE)
    let date: string | null
    let explicit = false
    if (due) {
      date = due[1]
      explicit = true
      content = content.replace(DUE_RE, '').replace(/\s{2,}/g, ' ').trim()
    } else {
      date = journalDate ?? fmDate
    }
    out.push({
      id: `${path}::${bodyLine + i}`,
      sourcePath: path,
      sourceName: nameOf(path),
      text: content,
      checked,
      date,
      explicit,
      line: bodyLine + i
    })
  }
  return out
}

export function aggregateTodos(notes: { path: string; text: string }[]): Todo[] {
  const all: Todo[] = []
  for (const n of notes) all.push(...extractTodos(n.path, n.text))
  return all
}

/** Open todos with a date strictly before `today`. */
export function overdue(todos: Todo[], today: string): Todo[] {
  return todos.filter((t) => !t.checked && t.date !== null && t.date < today)
}

export function dueOn(todos: Todo[], iso: string): Todo[] {
  return todos.filter((t) => t.date === iso)
}

/** Sort by date ascending; undated last; then by source name. */
export function sortByDate(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    if (a.date) return -1
    if (b.date) return 1
    return a.sourceName.localeCompare(b.sourceName)
  })
}
