import type { PullRequest, RepoData, RoleKey, UserProfile } from '../src/types.js'
import { t, localizeWorkerError, type MessageKey } from './i18n'

export type Provider = 'deepseek' | 'openai' | 'openrouter' | 'volcengine'
export const PROVIDERS: { id: Provider; label: string; defaultModel: string }[] = [
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-flash' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-4.1-mini' },
  { id: 'volcengine', label: '火山方舟', defaultModel: '' },
]
export interface ModelConfig { provider: Provider; model: string; apiKey: string }
export interface Message { role: 'system' | 'user' | 'assistant'; content: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJson(response: Response, limit = 2 * 1024 * 1024): Promise<unknown> {
  if (!response.body) throw new Error(t('emptyResponse'))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new Error(t('responseTooLarge'))
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(t('invalidResponseFormat'))
    throw error
  } finally {
    reader.releaseLock()
  }
}

export async function chat(config: ModelConfig, messages: Message[], signal?: AbortSignal): Promise<string> {
  const body = JSON.stringify({ provider: config.provider, model: config.model.trim(), apiKey: config.apiKey.trim(), messages })
  if (messages.some(message => message.content.length > 60_000) || messages.reduce((sum, message) => sum + message.content.length, 0) > 80_000 || new TextEncoder().encode(body).byteLength > 256 * 1024) throw new Error(t('materialTooLong'))
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body,
    signal,
  })
  const data = await readJson(response, 1024 * 1024)
  if (!response.ok) {
    // These are fixed, safe messages from our relay, never raw provider errors.
    const fallback = isRecord(data) && typeof data.error === 'string' ? data.error.slice(0, 200) : t('generateFailed')
    const message = localizeWorkerError(isRecord(data) ? data.code : undefined, fallback)
    throw new Error(config.apiKey ? message.split(config.apiKey.trim()).join(t('redactedCredential')) : message)
  }
  if (!isRecord(data) || typeof data.content !== 'string' || !data.content.trim()) throw new Error(t('modelEmpty'))
  return data.truncated === true ? `${data.content}\n\n> ${t('errOutputTruncated')}` : data.content
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function validateToken(token: string): void {
  if (token && !/^[\x21-\x7e]{8,512}$/.test(token)) throw new Error(t('invalidGithubToken'))
}

async function github(path: string, token: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) throw new DOMException(t('aborted'), 'AbortError')
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 20_000)
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (response.status === 401) throw new Error(t('invalidGithubTokenOrExpired'))
      if (response.status === 403 || response.status === 429) throw new Error(t('githubRateLimited'))
      if (response.status === 422) throw new Error(t('invalidGithubQuery'))
      throw new Error(t('githubUnavailable'))
    }
    return await readJson(response)
  } catch (error) {
    if (signal?.aborted) throw new DOMException(t('aborted'), 'AbortError')
    if (controller.signal.aborted) throw new Error(t('githubTimeout'))
    if (error instanceof TypeError) throw new Error(t('githubNetwork'))
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export async function importGitHub(
  input: { username: string; token?: string; from: string; to: string },
  signal?: AbortSignal,
): Promise<{ repos: RepoData[]; truncated: boolean; warnings: string[] }> {
  const username = input.username.trim()
  const token = (input.token ?? '').trim()
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) throw new Error(t('invalidGithubUsername'))
  if (!validDate(input.from) || !validDate(input.to) || input.from > input.to) throw new Error(t('invalidDateRange'))
  validateToken(token)
  const query = new URLSearchParams({ q: `author:${username} type:pr is:merged merged:${input.from}..${input.to}`, per_page: '30', sort: 'updated', order: 'desc' })
  const search = await github(`/search/issues?${query}`, token, signal)
  if (!isRecord(search) || !Array.isArray(search.items) || !Number.isSafeInteger(search.total_count) || Number(search.total_count) < 0) throw new Error(t('githubSearchMalformed'))
  const total = Number(search.total_count)
  const warnings: string[] = []
  const repos = new Map<string, RepoData>()
  let failed = 0
  let skipped = 0
  let trimmed = 0
  let cursor = 0
  const items = search.items.slice(0, 30)
  const seen = new Set<string>()
  let failureReason = ''

  async function consume(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) throw new DOMException(t('aborted'), 'AbortError')
      const item: unknown = items[cursor++]
      if (!isRecord(item) || typeof item.repository_url !== 'string' || !Number.isSafeInteger(item.number) || Number(item.number) < 1) { skipped++; continue }
      const match = /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/.exec(item.repository_url)
      if (!match || match[2] === '.' || match[2] === '..') { skipped++; continue }
      const [, org, name] = match
      const repoKey = `${org}/${name}`
      const prKey = `${repoKey}#${item.number}`
      if (seen.has(prKey)) { skipped++; continue }
      seen.add(prKey)
      let repo = repos.get(repoKey)
      if (!repo) {
        repo = { org, name, company: '', period: '', techStack: [], prs: [], requestedPrCount: 0, failedPrFetchCount: 0, skippedUnmergedPrCount: 0 }
        repos.set(repoKey, repo)
      }
      repo.requestedPrCount = (repo.requestedPrCount ?? 0) + 1
      try {
        const pr = await github(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}/pulls/${item.number}`, token, signal)
        if (!isRecord(pr) || typeof pr.title !== 'string' || !isRecord(pr.user) || typeof pr.user.login !== 'string' || pr.user.login.toLowerCase() !== username.toLowerCase()) throw new Error(t('prMismatch'))
        if (typeof pr.merged_at !== 'string' || !validDate(pr.merged_at.slice(0, 10)) || pr.merged_at.slice(0, 10) < input.from || pr.merged_at.slice(0, 10) > input.to) {
          skipped++
          repo.skippedUnmergedPrCount = (repo.skippedUnmergedPrCount ?? 0) + 1
          continue
        }
        if (pr.body !== null && pr.body !== undefined && typeof pr.body !== 'string') throw new Error(t('prBodyMalformed'))
        const body = typeof pr.body === 'string' ? pr.body : ''
        if (body.length > 1000 || pr.title.length > 300) trimmed++
        repo.prs.push({ title: pr.title.slice(0, 300), body: body.slice(0, 1000), mergedAt: pr.merged_at.slice(0, 10), filesChanged: [] })
      } catch (error) {
        if (signal?.aborted) throw new DOMException(t('aborted'), 'AbortError')
        failed++
        repo.failedPrFetchCount = (repo.failedPrFetchCount ?? 0) + 1
        failureReason = error instanceof Error ? error.message : t('githubUnavailable')
      }
    }
  }
  await Promise.all([consume(), consume(), consume()])
  const result = [...repos.values()].filter(repo => repo.prs.length > 0)
  for (const repo of result) {
    repo.prs.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
    repo.period = `${repo.prs.at(-1)!.mergedAt} — ${repo.prs[0].mergedAt}${t('prMergedDateSuffix')}`
  }
  result.sort((a, b) => b.prs[0].mergedAt.localeCompare(a.prs[0].mergedAt))
  const imported = result.reduce((sum, repo) => sum + repo.prs.length, 0)
  const truncated = total > items.length || Boolean(search.incomplete_results) || failed > 0 || skipped > 0
  warnings.push(t('warnSearchSummary', { total, imported }))
  if (search.incomplete_results) warnings.push(t('warnIncompleteSearch'))
  if (failed) warnings.push(t('warnPrFetchFailed', { failed, reason: failureReason }))
  if (skipped) warnings.push(t('warnSkipped', { skipped }))
  if (trimmed) warnings.push(t('warnTrimmed', { trimmed }))
  warnings.push(t('warnOrgNotCompany'))
  if (!token) warnings.push(t('warnNoToken'))
  return { repos: result, truncated, warnings }
}

function boundedString(value: unknown, label: string, max: number, optional = false): string {
  if (optional && value === undefined) return ''
  if (typeof value !== 'string' || value.length > max) throw new Error(t('fieldInvalid', { label }))
  return value
}

/** Parse only the explicit data schema. Never execute metadata or trust arbitrary cache properties. */
export function parseCacheJson(text: string): RepoData[] {
  if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024) throw new Error(t('cacheTooBig'))
  let data: unknown
  try { data = JSON.parse(text) as unknown } catch { throw new Error(t('invalidJsonFile')) }
  const list = Array.isArray(data) ? data : isRecord(data) ? data.repos : undefined
  if (!Array.isArray(list) || list.length > 50) throw new Error(t('cacheReposLimit'))
  let total = 0
  return list.map((value, index) => {
    if (!isRecord(value) || !Array.isArray(value.prs)) throw new Error(t('cacheRepoMissingPrs', { index: index + 1 }))
    total += value.prs.length
    if (total > 1000) throw new Error(t('cachePrLimit'))
    const name = boundedString(value.name, t('fieldRepoName'), 200)
    if (!name.trim()) throw new Error(t('repoNameEmpty'))
    const techStack = value.techStack ?? []
    if (!Array.isArray(techStack) || techStack.length > 50) throw new Error(t('techStackInvalid'))
    const prs: PullRequest[] = value.prs.map((pr: unknown) => {
      if (!isRecord(pr)) throw new Error(t('prDataInvalid'))
      const mergedAt = boundedString(pr.mergedAt, t('fieldPrDate'), 40)
      if (!validDate(mergedAt.slice(0, 10)) || !Number.isFinite(Date.parse(mergedAt))) throw new Error(t('prDateInvalid'))
      const files = pr.filesChanged ?? []
      if (!Array.isArray(files) || files.length > 1000) throw new Error(t('prFilesInvalid'))
      return {
        title: boundedString(pr.title, t('fieldPrTitle'), 1000),
        body: boundedString(pr.body, t('fieldPrBody'), 30_000, true),
        mergedAt,
        filesChanged: files.map(file => boundedString(file, t('fieldFilePath'), 500)),
      }
    })
    const repo: RepoData = {
      name,
      org: boundedString(value.org, t('fieldOrg'), 200, true),
      company: boundedString(value.company, t('fieldCompany'), 200, true),
      period: boundedString(value.period, t('fieldPeriod'), 200, true),
      techStack: techStack.map(tech => boundedString(tech, t('fieldTechName'), 100)),
      prs,
    }
    for (const key of ['requestedPrCount', 'failedPrFetchCount', 'skippedUnmergedPrCount'] as const) {
      if (value[key] !== undefined) {
        if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 100_000) throw new Error(t('cacheStatsInvalid'))
        repo[key] = Number(value[key])
      }
    }
    return repo
  })
}

export function buildWebResumeMessages(input: { profile: UserProfile; role: RoleKey; jd: string; experience: string; education: string; repos: RepoData[] }): Message[] {
  const summaries: unknown[] = []
  let budget = 20_000
  let sourceCount = 0
  let includedCount = 0
  for (const repo of input.repos.slice(0, 50)) {
    sourceCount += repo.prs.length
    const metadata = { name: repo.name.slice(0, 200), org: repo.org.slice(0, 200), companyProvidedByUser: repo.company.slice(0, 200), periodProvidedByUser: repo.period.slice(0, 200), declaredTechStack: repo.techStack.slice(0, 10).map(tech => tech.slice(0, 80)) }
    const metadataSize = JSON.stringify(metadata).length + 20
    if (budget < metadataSize) continue
    budget -= metadataSize
    const prs: { title: string; body: string; mergedAt: string }[] = []
    for (const pr of [...repo.prs].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)).slice(0, 30)) {
      const entry = { title: pr.title.slice(0, 300), body: pr.body.slice(0, 1000), mergedAt: pr.mergedAt.slice(0, 10) }
      const size = JSON.stringify(entry).length
      if (budget < size) break
      budget -= size
      prs.push(entry)
      includedCount++
    }
    if (prs.length) summaries.push({ ...metadata, prs })
  }
  const material = {
    profile: { name: input.profile.name.slice(0, 200), phone: input.profile.phone.slice(0, 200), email: input.profile.email.slice(0, 200), github: (input.profile.github ?? '').slice(0, 200) },
    targetRole: t(('role_' + input.role) as MessageKey),
    jd: input.jd.slice(0, 10_000),
    experience: input.experience.slice(0, 12_000),
    education: input.education.slice(0, 3000),
    limits: t('materialLimits'),
    sampling: t('materialSampling', { included: includedCount, source: sourceCount }),
    repositories: summaries,
  }
  return [
    { role: 'system', content: t('resumeSystemPrompt', { role: t(('role_' + input.role) as MessageKey) }) },
    { role: 'user', content: JSON.stringify(material) },
  ]
}

export function buildWebInterviewMessages(resume: string, jd: string): Message[] {
  return [
    { role: 'system', content: t('interviewSystemPrompt') },
    { role: 'user', content: JSON.stringify({ resume: resume.slice(0, 30_000), jd: jd.slice(0, 10_000), notice: t('interviewNotice') }) },
  ]
}
