import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parsePDFWithLLM } from '../../src/pdf/reader.js'

// Mock the AI client so tests don't make real API calls
vi.mock('../../src/ai/client.js', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../src/ai/client.js'

const sampleText = `
张三
电话: 13800000000 | 邮箱: foo@bar.com

工作经历
Golang 开发工程师 | 甲公司 | 2024.5 - 至今
Golang 开发工程师 | 乙公司 | 2022.4 - 2024.3
Java 工程师 | 丙公司 | 2020.11 - 2022.4

教育背景
示例大学 | 计算机科学与技术 | 本科 | 2014 - 2018
`

const mockLLMResponse = JSON.stringify({
  profile: {
    name: '张三',
    phone: '13800000000',
    email: 'foo@bar.com',
    github: '',
  },
  workExperience: [
    { company: '甲公司', title: 'Golang 开发工程师', period: '2024.5 - 至今' },
    { company: '乙公司', title: 'Golang 开发工程师', period: '2022.4 - 2024.3' },
    { company: '丙公司', title: 'Java 工程师', period: '2020.11 - 2022.4' },
  ],
  education: '示例大学 | 计算机科学与技术 | 本科 | 2014 - 2018',
})

beforeEach(() => {
  vi.mocked(callLLM).mockResolvedValue(mockLLMResponse)
})

describe('parsePDFWithLLM', () => {
  it('extracts multiple work entries', async () => {
    const result = await parsePDFWithLLM(sampleText)
    expect(result.workExperience).toHaveLength(3)
  })

  it('extracts company and period correctly', async () => {
    const result = await parsePDFWithLLM(sampleText)
    expect(result.workExperience[0].company).toContain('甲公司')
    expect(result.workExperience[0].period).toBe('2024.5 - 至今')
    expect(result.workExperience[0].source).toBe('pdf')
  })

  it('extracts education line', async () => {
    const result = await parsePDFWithLLM(sampleText)
    expect(result.education).toContain('示例大学')
  })

  it('extracts profile fields', async () => {
    const result = await parsePDFWithLLM(sampleText)
    expect(result.profile.name).toBe('张三')
    expect(result.profile.phone).toBe('13800000000')
    expect(result.profile.email).toBe('foo@bar.com')
  })

  it('handles LLM response wrapped in markdown code block', async () => {
    vi.mocked(callLLM).mockResolvedValue('```json\n' + mockLLMResponse + '\n```')
    const result = await parsePDFWithLLM(sampleText)
    expect(result.workExperience).toHaveLength(3)
  })

  it('throws when LLM returns no valid JSON', async () => {
    vi.mocked(callLLM).mockResolvedValue('抱歉，无法解析该简历。')
    await expect(parsePDFWithLLM(sampleText)).rejects.toThrow('大模型未返回有效 JSON')
  })
})
