import type { WorkExperience } from './types.js'

// Normalize a period endpoint like "2022.4" / "2022-4" / "2024.5" into YYYY-MM-DD.
// `asEnd` picks end-of-month; otherwise start-of-month.
export function normalizePeriodDate(raw: string, asEnd = false): string {
  const trimmed = raw.trim()
  if (trimmed === '至今' || trimmed === 'now' || trimmed.toLowerCase() === 'present') {
    return new Date().toISOString().slice(0, 10)
  }
  const m = trimmed.match(/^(\d{4})[-./年]?(\d{1,2})?[-./月]?(\d{1,2})?/)
  if (!m) throw new Error(`无法解析日期: ${raw}`)
  const year = Number(m[1])
  const month = m[2] ? Number(m[2]) : (asEnd ? 12 : 1)
  const day = m[3] ? Number(m[3]) : (asEnd ? new Date(year, month, 0).getDate() : 1)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Given a work-experience list like [{period: "2022.4 - 2024.3", company: "X"}, ...],
// return an overall date range covering all experiences (earliest start to "今天").
export function inferDateRangeFromExperience(
  exp: WorkExperience[],
): { from: string; to: string } | null {
  if (exp.length === 0) return null
  const starts: string[] = []
  const ends: string[] = []
  for (const e of exp) {
    const parts = e.period.split(/\s*[-~—–]\s*/)
    if (parts.length < 2) continue
    try {
      starts.push(normalizePeriodDate(parts[0]))
      ends.push(normalizePeriodDate(parts[1], true))
    } catch {
      // skip unparseable entries
    }
  }
  if (starts.length === 0) return null
  starts.sort()
  ends.sort()
  return { from: starts[0], to: ends[ends.length - 1] }
}

// Given a PR merge date and the work-experience list, return the matching
// {company, period}. Falls back to null if no period covers the date.
export function matchExperience(
  mergedAt: string,  // YYYY-MM-DD
  exp: WorkExperience[],
): { company: string; period: string } | null {
  for (const e of exp) {
    const parts = e.period.split(/\s*[-~—–]\s*/)
    if (parts.length < 2) continue
    try {
      const start = normalizePeriodDate(parts[0])
      const end = normalizePeriodDate(parts[1], true)
      if (mergedAt >= start && mergedAt <= end) {
        return { company: e.company, period: e.period }
      }
    } catch {
      // skip
    }
  }
  return null
}
