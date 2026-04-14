import pdfParse from 'pdf-parse'
import { readFile } from 'fs/promises'
import type { WorkExperience } from '../types.js'

export async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const buffer = await readFile(pdfPath)
  const data = await pdfParse(buffer)
  return data.text
}

export function parseWorkExperience(text: string): WorkExperience[] {
  const results: WorkExperience[] = []
  // Match lines like: "职位 | 公司 | 时间段"
  const linePattern = /([^\|]+)\|([^\|]+)\|\s*(\d{4}\.\d+\s*[-–]\s*(?:\d{4}\.\d+|至今))/g
  let match
  while ((match = linePattern.exec(text)) !== null) {
    results.push({
      title: match[1].trim(),
      company: match[2].trim(),
      period: match[3].trim(),
      source: 'pdf',
    })
  }
  return results
}

export function parseEducation(text: string): string {
  // Match lines containing school | major | degree | year
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.includes('大学') || line.includes('学院')) {
      const clean = line.trim()
      if (clean.length > 5) return clean
    }
  }
  return ''
}
