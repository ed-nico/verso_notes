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
export function parseLooseDate(input: string): string {
  const t = input.trim()
  if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) return t
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

/** If `path` is a daily note (nested or legacy-flat), return its ISO date, else null. */
export function dailyDateOf(path: string): string | null {
  const nested = new RegExp(`^${DAILY_DIR}/\\d{4}/\\d{2}/(\\d{4}-\\d{2}-\\d{2})\\.md$`).exec(path)
  if (nested) return nested[1]
  const flat = new RegExp(`^${DAILY_DIR}/(\\d{4}-\\d{2}-\\d{2})\\.md$`).exec(path)
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
