import { describe, it, expect } from 'vitest'
import { buildResumePrompt, buildInterviewPrompt } from '../../src/ai/prompt.js'
import type { RepoData } from '../../src/types.js'

const sampleRepo: RepoData = {
  name: 'jike-coco',
  org: 'iftechio',
  company: '即刻',
  period: '2024.5 - 至今',
  techStack: ['Go', 'gRPC', 'Kafka'],
  prs: [{ title: 'feat: add retry', body: 'retry on UNAVAILABLE', mergedAt: '2025-01', filesChanged: [] }],
}

describe('buildResumePrompt', () => {
  it('includes role emphasis and FAB framework in system prompt', () => {
    const { system } = buildResumePrompt(sampleRepo, 'go', null)
    expect(system).toContain('gRPC')
    expect(system).toContain('FAB')
    expect(system).toContain('岗位侧重')
  })

  it('includes JD keywords when JD provided', () => {
    const { user } = buildResumePrompt(sampleRepo, 'go', '要求熟悉高并发和微服务架构')
    expect(user).toContain('JD')
  })

  it('includes repo name and PR data', () => {
    const { user } = buildResumePrompt(sampleRepo, 'go', null)
    expect(user).toContain('jike-coco')
    expect(user).toContain('feat: add retry')
  })
})

describe('buildInterviewPrompt', () => {
  it('includes both resume and JD content', () => {
    const prompt = buildInterviewPrompt('resume content here', '岗位要求 Go 经验')
    expect(prompt).toContain('resume content here')
    expect(prompt).toContain('岗位要求 Go 经验')
  })
})
