import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parsePDFWithClaude } from '../../src/pdf/reader.js'

// Mock the AI client so tests don't make real API calls
vi.mock('../../src/ai/client.js', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../src/ai/client.js'

const sampleText = `
匡俊钢
电话: 13611735873 | 邮箱: foo@bar.com

工作经历
Golang 开发工程师 | 即刻 (iftechio) | 2024.5 - 至今
Golang 开发工程师 | 上海散爆网络科技有限公司 | 2022.4 - 2024.3
Java 工程师 | 游族网络 | 2020.11 - 2022.4

教育背景
上海大学 | 计算机科学与技术 | 本科 | 2014 - 2018
`

const mockClaudeResponse = JSON.stringify({
  profile: {
    name: '匡俊钢',
    phone: '13611735873',
    email: 'foo@bar.com',
    github: '',
  },
  workExperience: [
    { company: '即刻 (iftechio)', title: 'Golang 开发工程师', period: '2024.5 - 至今' },
    { company: '上海散爆网络科技有限公司', title: 'Golang 开发工程师', period: '2022.4 - 2024.3' },
    { company: '游族网络', title: 'Java 工程师', period: '2020.11 - 2022.4' },
  ],
  education: '上海大学 | 计算机科学与技术 | 本科 | 2014 - 2018',
})

beforeEach(() => {
  vi.mocked(callLLM).mockResolvedValue(mockClaudeResponse)
})

describe('parsePDFWithClaude', () => {
  it('extracts multiple work entries', async () => {
    const result = await parsePDFWithClaude(sampleText)
    expect(result.workExperience).toHaveLength(3)
  })

  it('extracts company and period correctly', async () => {
    const result = await parsePDFWithClaude(sampleText)
    expect(result.workExperience[0].company).toContain('即刻')
    expect(result.workExperience[0].period).toBe('2024.5 - 至今')
    expect(result.workExperience[0].source).toBe('pdf')
  })

  it('extracts education line', async () => {
    const result = await parsePDFWithClaude(sampleText)
    expect(result.education).toContain('上海大学')
  })

  it('extracts profile fields', async () => {
    const result = await parsePDFWithClaude(sampleText)
    expect(result.profile.name).toBe('匡俊钢')
    expect(result.profile.phone).toBe('13611735873')
    expect(result.profile.email).toBe('foo@bar.com')
  })

  it('handles Claude response wrapped in markdown code block', async () => {
    vi.mocked(callLLM).mockResolvedValue('```json\n' + mockClaudeResponse + '\n```')
    const result = await parsePDFWithClaude(sampleText)
    expect(result.workExperience).toHaveLength(3)
  })

  it('throws when Claude returns no valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('抱歉，无法解析该简历。')
    await expect(parsePDFWithClaude(sampleText)).rejects.toThrow('Claude 未返回有效 JSON')
  })
})
