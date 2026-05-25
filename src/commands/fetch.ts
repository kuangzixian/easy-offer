import ora from 'ora'
import chalk from 'chalk'
import { createGitHubClient, searchUserPRRepos, buildRepoData } from '../github/client.js'
import { extractTextFromPDF, parsePDFWithLLM } from '../pdf/reader.js'
import {
  askTargetPosition, askRole, askPDFPath, askUserProfile,
  askGitHubCredentials, askDateRange, confirmWorkHistory,
} from '../interactive/questions.js'
import { writeCache } from '../cache.js'
import { inferRoleFromJD } from '../roles.js'
import { inferDateRangeFromExperience, matchExperience } from '../period.js'
import { CliError } from '../utils/errors.js'
import type { Cache, RoleKey, WorkExperience, RepoData } from '../types.js'

export async function runFetch(options: { output?: string }) {
  const outputDir = options.output ?? '.'

  console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(chalk.bold('  easy-offer v1.0'))
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━\n'))

  // Step 1: Target position + JD
  const { position, jd } = await askTargetPosition()

  // Step 2: Role
  let inferredRole: RoleKey | undefined
  if (jd) {
    const spinner = ora('分析 JD，推断工种...').start()
    try {
      inferredRole = inferRoleFromJD(jd)
      spinner.succeed(`推断工种：${inferredRole}`)
    } catch {
      spinner.fail('推断失败，请手动选择')
    }
  }
  const role = await askRole(inferredRole)

  // Step 3: PDF
  const pdfPath = await askPDFPath()
  let existingExperience: WorkExperience[] = []
  let education = ''
  let profile: { name: string; phone: string; email: string; github?: string } = { name: '', phone: '', email: '', github: '' }

  if (pdfPath) {
    const spinner = ora('解析 PDF...').start()
    try {
      const text = await extractTextFromPDF(pdfPath)
      spinner.text = '用大模型解析简历内容...'
      const parsed = await parsePDFWithLLM(text)
      existingExperience = parsed.workExperience
      education = parsed.education
      profile = parsed.profile
      spinner.succeed(`解析成功，检测到 ${existingExperience.length} 段工作经历`)
      existingExperience = await confirmWorkHistory(existingExperience)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      spinner.fail(`PDF 解析失败：${msg}`)
      console.log(chalk.yellow('将改为手动输入；如需使用 PDF 解析，请检查 LLM 配置（easy-offer config）和 PDF 文件'))
    }
  }

  profile = await askUserProfile(profile)

  // Step 4: GitHub credentials
  const { token, username } = await askGitHubCredentials()
  const octokit = createGitHubClient(token)

  // Step 4.5: Date range — default from parsed experience if available
  const suggested = inferDateRangeFromExperience(existingExperience)
  console.log(chalk.bold('\n[步骤 4/5] 设定 PR 拉取的时间范围'))
  if (suggested) {
    console.log(chalk.dim(`  从已解析的工作经历推断：${suggested.from} ~ ${suggested.to}（可修改）`))
  }
  const { from, to } = await askDateRange(suggested?.from, suggested?.to)

  // Step 5: Auto-discover all repos where user has merged PRs in the date range
  const searchSpinner = ora(`搜索 ${username} 在 ${from} ~ ${to} 的所有合并 PR...`).start()
  let discovered: { owner: string; name: string; prNumbers: number[] }[] = []
  let truncated = false
  try {
    const result = await searchUserPRRepos(octokit, username, from, to)
    discovered = result.repos
    truncated = result.truncated
    const totalPRs = discovered.reduce((s, r) => s + r.prNumbers.length, 0)
    if (truncated) {
      searchSpinner.warn(
        `发现 ${discovered.length} 个相关仓库，共 ${totalPRs} 条 PR ` +
        `（已达 GitHub 搜索 1000 条上限，部分 PR 可能被遗漏；建议缩小时间范围重试）`,
      )
    } else {
      searchSpinner.succeed(`发现 ${discovered.length} 个相关仓库，共 ${totalPRs} 条 PR`)
    }
  } catch (err) {
    searchSpinner.fail('搜索失败')
    throw new CliError(`GitHub 搜索失败：${(err as Error).message}`)
  }

  if (discovered.length === 0) {
    console.log(chalk.yellow('未找到任何相关仓库，是否时间范围选得太窄？请重新运行 fetch。'))
    return
  }

  // Build the cache shell early and persist incrementally — if the user
  // ctrl-c's halfway through, the partial cache survives.
  const cache: Cache = {
    fetchedAt: new Date().toISOString(),
    username,
    role,
    jd: jd || null,
    targetPosition: position || null,
    profile,
    existingExperience,
    education,
    repos: [],
  }
  await writeCache(cache, outputDir)

  // Fetch PR bodies for each repo + auto-infer company/period from PR dates
  const fetchSpinner = ora('拉取 PR 详情...').start()
  const failed: string[] = []

  for (let i = 0; i < discovered.length; i++) {
    const r = discovered[i]
    fetchSpinner.text = `拉取 ${i + 1}/${discovered.length} ${r.owner}/${r.name}...`
    try {
      // Build with placeholder company/period; we'll overwrite after PR dates land.
      const repoData = await buildRepoData(octokit, r.owner, r.name, r.prNumbers, '', '')
      // Infer company/period from the most common match across this repo's PR dates.
      const matchCounts = new Map<string, { company: string; period: string; count: number }>()
      for (const pr of repoData.prs) {
        const match = matchExperience(pr.mergedAt, existingExperience)
        if (!match) continue
        const key = `${match.company}|${match.period}`
        const existing = matchCounts.get(key)
        if (existing) existing.count++
        else matchCounts.set(key, { ...match, count: 1 })
      }
      const best = [...matchCounts.values()].sort((a, b) => b.count - a.count)[0]
      if (best) {
        repoData.company = best.company
        repoData.period = best.period
      } else {
        repoData.company = '未分类'
        repoData.period = ''
      }
      cache.repos.push(repoData)
      // Persist progress after each repo so a failure mid-flight isn't fatal.
      await writeCache(cache, outputDir)
    } catch {
      failed.push(`${r.owner}/${r.name}`)
    }
  }

  fetchSpinner.succeed(
    `拉取完成，${cache.repos.length} 个仓库成功${failed.length > 0 ? `，${failed.length} 个失败` : ''}`,
  )
  if (failed.length > 0) {
    console.log(chalk.yellow(`⚠ 以下仓库拉取失败：${failed.join(', ')}`))
  }

  // Final write (covers the case where 0 repos succeeded — we still want
  // the latest fetchedAt and config).
  await writeCache(cache, outputDir)
  console.log(chalk.green(`\n✓ 数据已缓存到 .github-resume-cache.json`))
}
