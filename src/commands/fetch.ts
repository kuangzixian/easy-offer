import ora from 'ora'
import chalk from 'chalk'
import { createGitHubClient, searchUserPRRepos, buildRepoData } from '../github/client.js'
import { extractTextFromPDF, parsePDFWithLLM } from '../pdf/reader.js'
import {
  askTargetPosition, askRole, askPDFPath, askUserProfile,
  askGitHubCredentials, askDateRange, confirmWorkHistory,
} from '../interactive/questions.js'
import { writeCache } from '../cache.js'
import { inferRoleFromJD } from '../config.js'
import { inferDateRangeFromExperience, matchExperience } from '../period.js'
import type { Cache, RoleKey, WorkExperience, RepoData } from '../types.js'

export async function runFetch(options: { output?: string }) {
  const outputDir = options.output ?? '.'

  console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(chalk.bold('  easy-offer v1.0'))
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━\n'))

  // Step 0: Target position + JD
  const { position, jd } = await askTargetPosition()

  // Step 1: Role
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

  // Step 2: PDF
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

  // Step 3: GitHub credentials (no org)
  const { token, username } = await askGitHubCredentials()
  const octokit = createGitHubClient(token)

  // Step 3.5: Date range — default from parsed experience if available
  const suggested = inferDateRangeFromExperience(existingExperience)
  console.log(chalk.bold('\n[步骤 3/5] 设定 PR 拉取的时间范围'))
  if (suggested) {
    console.log(chalk.dim(`  从已解析的工作经历推断：${suggested.from} ~ ${suggested.to}（可修改）`))
  }
  const { from, to } = await askDateRange(suggested?.from, suggested?.to)

  // Step 4: Auto-discover all repos where user has merged PRs in the date range
  const searchSpinner = ora(`搜索 ${username} 在 ${from} ~ ${to} 的所有合并 PR...`).start()
  let discovered: { owner: string; name: string; prCount: number }[] = []
  try {
    discovered = await searchUserPRRepos(octokit, username, from, to)
    searchSpinner.succeed(`发现 ${discovered.length} 个相关仓库，共 ${discovered.reduce((s, r) => s + r.prCount, 0)} 条 PR`)
  } catch (err) {
    searchSpinner.fail('搜索失败')
    console.error((err as Error).message)
    process.exit(1)
  }

  if (discovered.length === 0) {
    console.log(chalk.yellow('未找到任何相关仓库，是否时间范围选得太窄？请重新运行 fetch。'))
    process.exit(0)
  }

  // Step 5: Fetch PR bodies for each repo + auto-infer company/period from PR dates
  const fetchSpinner = ora('拉取 PR 详情...').start()
  const repos: RepoData[] = []
  const failed: string[] = []

  for (const r of discovered) {
    try {
      fetchSpinner.text = `拉取 ${r.owner}/${r.name}...`
      // First build with placeholder company/period; we'll overwrite below using PR dates
      const repoData = await buildRepoData(octokit, r.owner, r.name, username, '', '', from)
      // Infer company/period from the most common match across this repo's PR dates
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
      repos.push(repoData)
    } catch {
      failed.push(`${r.owner}/${r.name}`)
    }
  }

  fetchSpinner.succeed(`拉取完成，${repos.length} 个仓库成功${failed.length > 0 ? `，${failed.length} 个失败` : ''}`)
  if (failed.length > 0) {
    console.log(chalk.yellow(`⚠ 以下仓库拉取失败：${failed.join(', ')}`))
  }

  const cache: Cache = {
    fetchedAt: new Date().toISOString(),
    username,
    role,
    jd: jd || null,
    targetPosition: position || null,
    profile,
    existingExperience,
    education,
    repos,
  }

  await writeCache(cache, outputDir)
  console.log(chalk.green(`\n✓ 数据已缓存到 .github-resume-cache.json`))
}
