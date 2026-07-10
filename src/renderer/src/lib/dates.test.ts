import { describe, it, expect } from 'vitest'
import { parseLooseDate } from './dates'

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
