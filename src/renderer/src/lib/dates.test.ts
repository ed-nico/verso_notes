import { describe, it, expect } from 'vitest'
import { dateSuggestions, parseLooseDate } from './dates'

describe('parseLooseDate', () => {
  it('keeps an ISO date as-is', () => {
    expect(parseLooseDate('2018-03-01')).toBe('2018-03-01')
  })

  it('parses space-separated day-month-year (the reported case)', () => {
    expect(parseLooseDate('01 03 2018')).toBe('2018-03-01')
  })

  it('parses slashes and dots', () => {
    expect(parseLooseDate('1/3/2018')).toBe('2018-03-01')
    expect(parseLooseDate('01.03.2018')).toBe('2018-03-01')
  })

  it('reads day-first but disambiguates when a part is > 12', () => {
    expect(parseLooseDate('25/12/2018')).toBe('2018-12-25')
    expect(parseLooseDate('12/25/2018')).toBe('2018-12-25') // 25 can only be the day
  })

  it('expands a 2-digit year', () => {
    expect(parseLooseDate('1 3 18')).toBe('2018-03-01')
  })

  it('zero-pads month and day', () => {
    expect(parseLooseDate('5 7 2020')).toBe('2020-07-05')
  })

  it('returns non-date text untouched', () => {
    expect(parseLooseDate('Reading')).toBe('Reading')
    expect(parseLooseDate('')).toBe('')
    expect(parseLooseDate('2018')).toBe('2018')
  })

  it('rejects impossible day/month and keeps raw', () => {
    expect(parseLooseDate('40 40 2018')).toBe('40 40 2018')
  })
})

describe('dateSuggestions (natural-language [[ dates)', () => {
  // 2026-07-14 is a Tuesday.
  const T = '2026-07-14'
  const iso = (q: string): string[] => dateSuggestions(q, T).map((s) => s.iso)

  it('prefix-matches relative words', () => {
    expect(iso('tomo')).toEqual(['2026-07-15'])
    expect(iso('yest')).toEqual(['2026-07-13'])
    expect(iso('today')).toEqual(['2026-07-14'])
  })

  it('handles next/last weekday and bare weekday prefixes', () => {
    expect(iso('next friday')).toEqual(['2026-07-17'])
    expect(iso('last friday')).toEqual(['2026-07-10'])
    expect(iso('fri')).toEqual(['2026-07-17'])
    // Same weekday as today → a week out, never today.
    expect(iso('next tuesday')).toEqual(['2026-07-21'])
  })

  it('handles relative counts', () => {
    expect(iso('3 days ago')).toEqual(['2026-07-11'])
    expect(iso('in 2 weeks')).toEqual(['2026-07-28'])
  })

  it('handles month-day forms, rolling past dates to next year', () => {
    expect(iso('dec 25')).toEqual(['2026-12-25'])
    expect(iso('12/25')).toEqual(['2026-12-25'])
    expect(iso('feb 1')).toEqual(['2027-02-01']) // already past in 2026
    expect(iso('feb 30')).toEqual([]) // not a real date
  })

  it('dedupes by day and caps at 3', () => {
    const s = dateSuggestions('to', T)
    expect(s.length).toBeLessThanOrEqual(3)
    expect(new Set(s.map((x) => x.iso)).size).toBe(s.length)
  })

  it('returns nothing for short or non-date queries', () => {
    expect(iso('t')).toEqual([])
    expect(iso('meeting notes')).toEqual([])
  })
})
