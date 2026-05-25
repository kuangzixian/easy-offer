import { describe, it, expect } from 'vitest'
import { extractTechStack, summarizePRs } from '../../src/github/parser.js'
import type { PullRequest } from '../../src/types.js'

const samplePRs: PullRequest[] = [
  {
    title: 'feat: add gRPC service config with retry',
    body: 'Added INTERNAL/UNAVAILABLE error retry using service config. Uses Go and gRPC.',
    mergedAt: '2025-01-10',
    filesChanged: [],
  },
  {
    title: 'feat: integrate Kafka consumer group',
    body: 'Implemented Kafka consumer with error retry and dead letter queue.',
    mergedAt: '2025-02-01',
    filesChanged: [],
  },
]

describe('extractTechStack', () => {
  it('extracts known tech keywords from PR titles and bodies', () => {
    const result = extractTechStack(samplePRs)
    expect(result).toContain('Go')
    expect(result).toContain('gRPC')
    expect(result).toContain('Kafka')
  })

  it('returns deduplicated list', () => {
    const result = extractTechStack(samplePRs)
    const unique = [...new Set(result)]
    expect(result).toEqual(unique)
  })

  // Word-boundary regression tests — these would fail under naive substring matching.
  it('does NOT match "Go" inside words like google, going, mongo', () => {
    const prs: PullRequest[] = [{
      title: 'integrate google login',
      body: 'going to use mongodb logout flow with logo update',
      mergedAt: '2025-01-01',
      filesChanged: [],
    }]
    const result = extractTechStack(prs)
    expect(result).not.toContain('Go')
  })

  it('does NOT match "Java" inside "javascript"', () => {
    const prs: PullRequest[] = [{
      title: 'add javascript build step',
      body: 'using javascript and typescript only',
      mergedAt: '2025-01-01',
      filesChanged: [],
    }]
    const result = extractTechStack(prs)
    expect(result).not.toContain('Java')
    expect(result).toContain('TypeScript')
    expect(result).toContain('JavaScript')
  })

  it('matches "Go" only when surrounded by non-alphanumeric chars', () => {
    const prs: PullRequest[] = [{
      title: 'switch to Go for backend',
      body: 'Rewrote the service in Go.',
      mergedAt: '2025-01-01',
      filesChanged: [],
    }]
    expect(extractTechStack(prs)).toContain('Go')
  })

  it('handles "Node.js" as a single keyword (dot is part of the keyword)', () => {
    const prs: PullRequest[] = [{
      title: 'upgrade to Node.js 20',
      body: 'Bumped Node.js engine.',
      mergedAt: '2025-01-01',
      filesChanged: [],
    }]
    expect(extractTechStack(prs)).toContain('Node.js')
  })
})

describe('summarizePRs', () => {
  it('returns array of summary strings from PR titles', () => {
    const result = summarizePRs(samplePRs)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('gRPC')
  })

  it('truncates body to 500 chars', () => {
    const longBody = 'x'.repeat(1000)
    const prs: PullRequest[] = [{ title: 'test', body: longBody, mergedAt: '2025-01-01', filesChanged: [] }]
    const result = summarizePRs(prs)
    expect(result[0].length).toBeLessThan(600)
  })
})
