import { describe, it, expect } from 'vitest'
import { parseWorkExperience, parseEducation } from '../../src/pdf/reader.js'

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

describe('parseWorkExperience', () => {
  it('extracts multiple work entries', () => {
    const result = parseWorkExperience(sampleText)
    expect(result).toHaveLength(3)
  })

  it('extracts company and period correctly', () => {
    const result = parseWorkExperience(sampleText)
    expect(result[0].company).toContain('即刻')
    expect(result[0].period).toBe('2024.5 - 至今')
    expect(result[0].source).toBe('pdf')
  })
})

describe('parseEducation', () => {
  it('extracts education line', () => {
    const result = parseEducation(sampleText)
    expect(result).toContain('上海大学')
  })
})
