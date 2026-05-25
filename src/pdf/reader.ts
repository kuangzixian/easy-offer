import pdfParse from 'pdf-parse'
import { readFile } from 'fs/promises'
import { callLLM } from '../ai/client.js'
import { extractJSONObject } from '../utils/json.js'
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

/**
 * Validate & normalize the LLM-emitted JSON. Tolerant of missing fields
 * (defaults to empty strings / arrays) but strict about top-level shape:
 * the LLM cannot return e.g. `workExperience: "foo"` — that throws a
 * descriptive error rather than crashing inside `.map`.
 */
function normalizeParsedResume(raw: unknown): ParsedResume {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('LLM 返回的不是 JSON 对象')
  }
  const data = raw as Record<string, unknown>

  const profileRaw = (data.profile && typeof data.profile === 'object' ? data.profile : {}) as Record<string, unknown>
  const profile: UserProfile = {
    name: typeof profileRaw.name === 'string' ? profileRaw.name : '',
    phone: typeof profileRaw.phone === 'string' ? profileRaw.phone : '',
    email: typeof profileRaw.email === 'string' ? profileRaw.email : '',
    github: typeof profileRaw.github === 'string' ? profileRaw.github : '',
  }

  if (data.workExperience !== undefined && !Array.isArray(data.workExperience)) {
    throw new Error('LLM 返回的 workExperience 字段不是数组')
  }
  const workExperience: WorkExperience[] = (data.workExperience as unknown[] ?? [])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map(e => ({
      company: typeof e.company === 'string' ? e.company : '',
      title: typeof e.title === 'string' ? e.title : '',
      period: typeof e.period === 'string' ? e.period : '',
      source: 'pdf' as const,
    }))

  return {
    profile,
    workExperience,
    education: typeof data.education === 'string' ? data.education : '',
  }
}

export async function parsePDFWithLLM(text: string): Promise<ParsedResume> {
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

  const raw = await callLLM(system, user, 2000)

  let jsonText: string
  try {
    jsonText = extractJSONObject(raw)
  } catch {
    throw new Error('大模型未返回有效 JSON')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(`大模型返回的 JSON 解析失败: ${(err as Error).message}`)
  }

  return normalizeParsedResume(parsed)
}
