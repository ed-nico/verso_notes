/**
 * Vault-wide todo extraction. A todo is any Markdown task line (`- [ ]` / `- [x]`).
 * Its "date" is resolved as: an explicit inline due date (`@2026-06-20`, `📅 …`,
 * `due:…`, or the first `[[2026-06-20]]` daily-note link — scheduling by
 * association, Reflect-style), else the note's frontmatter `date`, else the day
 * of a daily note (implicit).
 */
import { parseFrontmatter } from './frontmatter'
import { dailyDateOf, isValidISO } from './dates'

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
  /** Ancestor list-item labels ("Project › Phase 2"), for orientation in flat lists. */
  crumbs: string[]
  line: number
}

const TASK_RE = /^(\s*)- \[([ xX])\]\s+(.*)$/
const DUE_RE = /(?:@|📅\s?|due:)(\d{4}-\d{2}-\d{2})/
/** A `[[YYYY-MM-DD]]` daily-note link inside a task = its due date (kept in the text). */
const DATE_LINK_RE = /\[\[(\d{4}-\d{2}-\d{2})\]\]/
/** Plain list line (for breadcrumb ancestry) — bullets and numbered items. */
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
/** Parent labels too generic to orient anyone — hidden from breadcrumbs. */
const GENERIC_CRUMB_RE = /^(tasks?|todos?|to-dos?)\s*:?\s*$/i

function nameOf(path: string): string {
  return path.replace(/\.md$/i, '').split('/').pop() ?? path
}

function extractTodos(path: string, text: string): Todo[] {
  const { data, body, bodyLine } = parseFrontmatter(text)
  const fmDate = typeof data.date === 'string' ? data.date : null
  const journalDate = dailyDateOf(path)
  const out: Todo[] = []
  const lines = body.split('\n')
  // Ancestry of enclosing (non-task) list items, for breadcrumbs.
  const stack: { indent: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const list = lines[i].match(LIST_RE)
    if (!list) {
      if (lines[i].trim() !== '') stack.length = 0 // a non-list line breaks the outline
      continue
    }
    const indent = list[1].length
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()

    const m = lines[i].match(TASK_RE)
    if (!m) {
      stack.push({ indent, text: list[2].trim() })
      continue
    }
    const checked = m[2].toLowerCase() === 'x'
    let content = m[3]
    const due = content.match(DUE_RE)
    const dateLink = content.match(DATE_LINK_RE)
    let date: string | null
    let explicit = false
    if (due) {
      date = due[1]
      explicit = true
      content = content.replace(DUE_RE, '').replace(/\s{2,}/g, ' ').trim()
    } else if (dateLink && isValidISO(dateLink[1])) {
      // Scheduling by association: the linked day IS the due date. The link
      // stays in the text — it's still a working link to that journal day.
      date = dateLink[1]
      explicit = true
    } else {
      date = journalDate ?? fmDate
    }
    const crumbs = stack
      .map((s) => s.text.replace(/\s\^[A-Za-z0-9-]+\s*$/, ''))
      .filter((t) => t && !GENERIC_CRUMB_RE.test(t))
      .slice(-2)
      .map((t) => (t.length > 34 ? t.slice(0, 33) + '…' : t))
    out.push({
      id: `${path}::${bodyLine + i}`,
      sourcePath: path,
      sourceName: nameOf(path),
      text: content,
      checked,
      date,
      explicit,
      crumbs,
      line: bodyLine + i
    })
  }
  return out
}

/**
 * Per-note cache (same pattern as query.ts's scanCache): the Journal/Todos views
 * re-aggregate on every debounced index rebuild while open, so only the note that
 * actually changed should pay for a re-scan — unchanged texts hit the cache by
 * string identity.
 */
const todoCache = new Map<string, { text: string; todos: Todo[] }>()

/** Empty the cache — call when switching vaults so notes can't leak across. */
export function clearTodoCache(): void {
  todoCache.clear()
}

export function aggregateTodos(notes: { path: string; text: string }[]): Todo[] {
  const all: Todo[] = []
  for (const n of notes) {
    const hit = todoCache.get(n.path)
    let todos: Todo[]
    if (hit && hit.text === n.text) {
      todos = hit.todos
    } else {
      todos = extractTodos(n.path, n.text)
      todoCache.set(n.path, { text: n.text, todos })
    }
    all.push(...todos)
  }
  return all
}

/** Open todos with an EXPLICIT date strictly before `today`. Deliberately
 *  asymmetric (Reflect-style): a bare checkbox in an old daily note is just an
 *  open task, not "late" — only an explicit due date can make you overdue. */
export function overdue(todos: Todo[], today: string): Todo[] {
  return todos.filter((t) => !t.checked && t.explicit && t.date !== null && t.date < today)
}

/** Open tasks whose IMPLICIT date (journal day / note date) has passed — the
 *  older-journal backlog, shown apart from real overdues. */
export function journalBacklog(todos: Todo[], today: string): Todo[] {
  return todos.filter((t) => !t.checked && !t.explicit && t.date !== null && t.date < today)
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
