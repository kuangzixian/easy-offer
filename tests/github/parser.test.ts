import { describe, it, expect } from 'vitest'
import { extractTechStack, summarizePRs } from '../../src/github/parser.js'
import type { PullRequest } from '../../src/types.js'

const samplePRs: PullRequest[] = [
  {
    title: 'feat: add gRPC service config with retry',
    body: 'Added INTERNAL/UNAVAILABLE error retry using service config. Uses Go and gRPC.',
    mergedAt: '2025-01-10',
    filesChanged: ['cocogrpc/client.go', 'cocogrpc/retry.go'],
  },
  {
    title: 'feat: integrate Kafka consumer group',
    body: 'Implemented Kafka consumer with error retry and dead letter queue.',
    mergedAt: '2025-02-01',
    filesChanged: ['kafka/consumer.go', 'kafka/producer.go'],
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
