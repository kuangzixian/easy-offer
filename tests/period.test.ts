import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizePeriodDate, inferDateRangeFromExperience, matchExperience } from '../src/period.js'
import type { WorkExperience } from '../src/types.js'

describe('normalizePeriodDate', () => {
  it('parses YYYY.M into YYYY-MM-01 (start)', () => {
    expect(normalizePeriodDate('2022.4')).toBe('2022-04-01')
    expect(normalizePeriodDate('2024.5')).toBe('2024-05-01')
  })

  it('parses YYYY.M into end-of-month when asEnd', () => {
    expect(normalizePeriodDate('2022.4', true)).toBe('2022-04-30')
    expect(normalizePeriodDate('2024.2', true)).toBe('2024-02-29') // leap year
    expect(normalizePeriodDate('2023.2', true)).toBe('2023-02-28')
  })

  it('parses YYYY-MM-DD untouched', () => {
    expect(normalizePeriodDate('2022-04-15')).toBe('2022-04-15')
  })

  it('parses year only → Jan 1 / Dec 31', () => {
    expect(normalizePeriodDate('2020')).toBe('2020-01-01')
    expect(normalizePeriodDate('2020', true)).toBe('2020-12-31')
  })

  it('resolves 至今 / now / present to today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(normalizePeriodDate('至今')).toBe(today)
    expect(normalizePeriodDate('now')).toBe(today)
    expect(normalizePeriodDate('Present')).toBe(today)
  })
})

describe('inferDateRangeFromExperience', () => {
  const fixedToday = '2026-04-21'
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(fixedToday + 'T00:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('returns null when no experience', () => {
    expect(inferDateRangeFromExperience([])).toBeNull()
  })

  it('spans earliest start to latest end across entries', () => {
    const exp: WorkExperience[] = [
      { company: 'A', title: 't', period: '2020.11 - 2022.4', source: 'pdf' },
      { company: 'B', title: 't', period: '2018.3 - 2019.6', source: 'pdf' },
      { company: 'C', title: 't', period: '2022.4 - 2024.3', source: 'pdf' },
    ]
    expect(inferDateRangeFromExperience(exp)).toEqual({ from: '2018-03-01', to: '2024-03-31' })
  })

  it('handles 至今 as latest', () => {
    const exp: WorkExperience[] = [
      { company: 'A', title: 't', period: '2020.11 - 2022.4', source: 'pdf' },
      { company: 'B', title: 't', period: '2024.5 - 至今', source: 'pdf' },
    ]
    expect(inferDateRangeFromExperience(exp)?.to).toBe(fixedToday)
  })
})

describe('matchExperience', () => {
  const exp: WorkExperience[] = [
    { company: '散爆', title: 't', period: '2022.4 - 2024.3', source: 'pdf' },
    { company: '游族', title: 't', period: '2020.11 - 2022.4', source: 'pdf' },
  ]

  it('matches a date inside a period', () => {
    expect(matchExperience('2023-06-15', exp)).toEqual({ company: '散爆', period: '2022.4 - 2024.3' })
  })

  it('returns null when no period covers the date', () => {
    expect(matchExperience('2019-01-01', exp)).toBeNull()
  })

  it('handles boundary (inclusive)', () => {
    expect(matchExperience('2022-04-30', exp)?.company).toBeTruthy()
  })
})
