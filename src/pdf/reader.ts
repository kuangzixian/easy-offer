import pdfParse from 'pdf-parse'
import { readFile } from 'fs/promises'
import { callClaude } from '../ai/client.js'
import type { WorkExperience, UserProfile } from '../types.js'

export async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const buffer = await readFile(pdfPath)
  const data = await pdfParse(buffer)
  return data.text
}

export interface ParsedResume {
  profile: UserProfile
  workExperience: WorkExperience[]
  education: string
}

export async function parsePDFWithClaude(text: string): Promise<ParsedResume> {
  const system = `你是一个简历解析助手。从用户提供的简历文本中提取结构化信息，严格按照 JSON 格式返回，不要添加任何解释。`

  const user = `请从以下简历文本中提取信息，返回如下 JSON 格式（字段缺失时用空字符串）：

{
  "profile": {
    "name": "姓名",
    "phone": "手机号",
    "email": "邮箱",
    "github": "GitHub用户名或链接（可选）"
  },
  "workExperience": [
    {
      "company": "公司名",
      "title": "职位",
      "period": "时间段，如 2022.4 - 2024.3"
    }
  ],
  "education": "最高学历一行，如 XX大学 | 计算机科学 | 本科 | 2018-2022"
}

简历文本：
${text}`

  const raw = await callClaude(system, user, 2000)

  // Extract JSON from response (Claude may wrap in markdown code blocks)
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude 未返回有效 JSON')

  const parsed = JSON.parse(jsonMatch[0])

  const workExperience: WorkExperience[] = (parsed.workExperience ?? []).map((e: any) => ({
    company: e.company ?? '',
    title: e.title ?? '',
    period: e.period ?? '',
    source: 'pdf' as const,
  }))

  return {
    profile: {
      name: parsed.profile?.name ?? '',
      phone: parsed.profile?.phone ?? '',
      email: parsed.profile?.email ?? '',
      github: parsed.profile?.github ?? '',
    },
    workExperience,
    education: parsed.education ?? '',
  }
}
