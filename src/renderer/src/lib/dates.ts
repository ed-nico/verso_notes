/** Date helpers for journaling. Dates are handled in local time as YYYY-MM-DD. */

const DAILY_DIR = 'Daily'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local-time ISO date (YYYY-MM-DD). */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(): string {
  return isoDate(new Date())
}

/**
 * Parse a loosely-typed date into `YYYY-MM-DD`. Accepts ISO as-is and numeric forms
 * separated by `/ - . ` or spaces ("01 03 2018", "1/3/18"). When day vs month is
 * ambiguous (both ≤ 12) it reads day-first (the international order). Returns the
 * trimmed input unchanged when it can't be parsed, so non-date text is never mangled.
 */
/** True for a well-formed AND plausible ISO date (rejects `2026-13-45`). */
export function isValidISO(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

export function parseLooseDate(input: string): string {
  const t = input.trim()
  if (!t || isValidISO(t)) return t
  // ISO-shaped but impossible (month 13, day 45): not a date — leave it alone
  // rather than passing it through as if valid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const nums = t.match(/\d+/g)
  if (!nums || nums.length < 3) return t
  // Year = a 4-digit group, else one clearly too big for a day (> 31), else the last.
  let yi = nums.findIndex((n) => n.length === 4)
  if (yi < 0) yi = nums.findIndex((n) => Number(n) > 31)
  if (yi < 0) yi = nums.length - 1
  const yn = Number(nums[yi])
  const year = nums[yi].length <= 2 ? 2000 + yn : yn
  const rest = nums.filter((_, i) => i !== yi).slice(0, 2).map(Number)
  if (rest.length < 2) return t
  const [a, b] = rest
  let day: number
  let month: number
  if (a > 12 && b <= 12) {
    day = a
    month = b
  } else if (b > 12 && a <= 12) {
    month = a
    day = b
  } else {
    day = a // ambiguous → day-first
    month = b
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return t
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Parse YYYY-MM-DD into a local Date, or null. */
function parseISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  if (!d) return iso
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

/** Nested path: Daily/YYYY/MM/YYYY-MM-DD.md — keeps the folder shallow as it grows. */
export function dailyPath(iso: string): string {
  return `${DAILY_DIR}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso}.md`
}

// Hoisted: dailyDateOf runs in per-note scan loops — don't build regexes per call.
const DAILY_NESTED_RE = new RegExp(`^${DAILY_DIR}/\\d{4}/\\d{2}/(\\d{4}-\\d{2}-\\d{2})\\.md$`)
const DAILY_FLAT_RE = new RegExp(`^${DAILY_DIR}/(\\d{4}-\\d{2}-\\d{2})\\.md$`)

/** If `path` is a daily note (nested or legacy-flat), return its ISO date, else null. */
export function dailyDateOf(path: string): string | null {
  const nested = DAILY_NESTED_RE.exec(path)
  if (nested) return nested[1]
  const flat = DAILY_FLAT_RE.exec(path)
  return flat ? flat[1] : null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

/** "Monday, 15 June 2026" */
export function formatLong(iso: string): string {
  const d = parseISO(iso)
  if (!d) return iso
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "Mon" / "15 Jun" style short label. */
export function formatShort(iso: string): string {
  const d = parseISO(iso)
  if (!d) return iso
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

export function monthLabel(year: number, month0: number): string {
  return `${MONTHS[month0]} ${year}`
}

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * A Monday-first 6×7 grid of ISO dates covering the month, with leading/trailing
 * days from adjacent months for a full calendar.
 */
export function monthGrid(year: number, month0: number): string[][] {
  const first = new Date(year, month0, 1)
  // JS getDay: 0=Sun..6=Sat; shift so Monday=0.
  const lead = (first.getDay() + 6) % 7
  const start = new Date(year, month0, 1 - lead)
  const weeks: string[][] = []
  const cur = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      week.push(isoDate(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

export function monthOf(iso: string): { year: number; month0: number } {
  const d = parseISO(iso) ?? new Date()
  return { year: d.getFullYear(), month0: d.getMonth() }
}

// ---------------------------------------------------------------------------
// Natural-language date suggestions for `[[` autocomplete (Reflect-style):
// typing `[[tomo`, `[[next friday`, `[[3 days ago`, `[[dec 25`, `[[12/25`
// offers the resolved daily date. Pure and deterministic — `today` is injected
// so tests never depend on the wall clock.
// ---------------------------------------------------------------------------

export interface DateSuggestion {
  /** Human label for the row, e.g. "Tomorrow" or "Next Friday". */
  label: string
  /** Resolved local date, YYYY-MM-DD. */
  iso: string
}

const WEEKDAYS_LC = WEEKDAYS.map((w) => w.toLowerCase())
const MONTHS_LC = MONTHS.map((m) => m.toLowerCase())
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1)

/** Up to 3 date suggestions for a (partial) query, deduped by day. */
export function dateSuggestions(query: string, todayIso: string = todayISO()): DateSuggestion[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const today = parseISO(todayIso)
  if (!today) return []
  const out: DateSuggestion[] = []
  const onDay = (offset: number): string => {
    const d = new Date(today)
    d.setDate(d.getDate() + offset)
    return isoDate(d)
  }

  // Simple relative words, prefix-matched ("tomo" → Tomorrow).
  const words: [string, number][] = [
    ['today', 0],
    ['tomorrow', 1],
    ['yesterday', -1]
  ]
  for (const [w, off] of words) {
    if (w.startsWith(q)) out.push({ label: cap(w), iso: onDay(off) })
  }

  // "[next|last] <weekday>" (prefix-matched weekday; bare weekday = the next one).
  const wk = q.match(/^(?:(next|last)\s+)?([a-z]{2,})$/)
  if (wk) {
    for (let i = 0; i < 7; i++) {
      if (!WEEKDAYS_LC[i].startsWith(wk[2])) continue
      const dir = wk[1] === 'last' ? -1 : 1
      // Days until the next (or since the last) occurrence, never 0 (that's "today").
      let delta = ((i - today.getDay()) * dir + 7) % 7
      if (delta === 0) delta = 7
      out.push({
        label: (wk[1] ? cap(wk[1]) + ' ' : '') + WEEKDAYS[i],
        iso: onDay(delta * dir)
      })
    }
  }

  // "3 days ago" / "in 2 weeks".
  let m = q.match(/^(\d{1,3})\s*(day|week)s?\s+ago$/)
  if (m) out.push({ label: cap(q), iso: onDay(-Number(m[1]) * (m[2] === 'week' ? 7 : 1)) })
  m = q.match(/^in\s+(\d{1,3})\s*(day|week)s?$/)
  if (m) out.push({ label: cap(q), iso: onDay(Number(m[1]) * (m[2] === 'week' ? 7 : 1)) })

  // "dec 25" / "december 25" — this year, or next year when already past.
  m = q.match(/^([a-z]{3,})\s+(\d{1,2})$/)
  if (m) {
    const dayNum = Number(m[2])
    for (let i = 0; i < 12; i++) {
      if (!MONTHS_LC[i].startsWith(m[1]) || dayNum < 1 || dayNum > 31) continue
      const d = new Date(today.getFullYear(), i, dayNum)
      if (d.getMonth() !== i) continue // e.g. Feb 30 rolled over — not a real date
      if (isoDate(d) < todayIso) d.setFullYear(d.getFullYear() + 1)
      out.push({ label: `${MONTHS[i]} ${dayNum}`, iso: isoDate(d) })
    }
  }

  // "12/25" or "12-25" — month/day, this year or next.
  m = q.match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (m) {
    const [mo, dayNum] = [Number(m[1]), Number(m[2])]
    if (mo >= 1 && mo <= 12 && dayNum >= 1 && dayNum <= 31) {
      const d = new Date(today.getFullYear(), mo - 1, dayNum)
      if (d.getMonth() === mo - 1) {
        if (isoDate(d) < todayIso) d.setFullYear(d.getFullYear() + 1)
        out.push({ label: `${MONTHS[mo - 1]} ${dayNum}`, iso: isoDate(d) })
      }
    }
  }

  const seen = new Set<string>()
  return out.filter((s) => !seen.has(s.iso) && !!seen.add(s.iso)).slice(0, 3)
}
