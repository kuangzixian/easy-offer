import ora from 'ora'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { createGitHubClient, listOrgRepos, buildRepoData } from '../github/client.js'
import { extractTextFromPDF, parsePDFWithClaude } from '../pdf/reader.js'
import {
  askTargetPosition, askRole, askPDFPath, askUserProfile,
  askGitHubCredentials, askRepoSelection, confirmWorkHistory,
} from '../interactive/questions.js'
import { writeCache } from '../cache.js'
import { inferRoleFromJD } from '../config.js'
import type { Cache, RoleKey, WorkExperience, RepoData } from '../types.js'

export async function runFetch(options: { output?: string }) {
  const outputDir = options.output ?? '.'

  console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(chalk.bold('  easy-offer v1.0'))
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━\n'))

  // Step 0: Target position + JD
  const { position, jd } = await askTargetPosition()

  // Step 1: Role (infer from JD if available)
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
      spinner.text = '用 Claude 解析简历内容...'
      const parsed = await parsePDFWithClaude(text)
      existingExperience = parsed.workExperience
      education = parsed.education
      profile = parsed.profile
      spinner.succeed(`解析成功，检测到 ${existingExperience.length} 段工作经历`)
      existingExperience = await confirmWorkHistory(existingExperience)
    } catch {
      spinner.fail('PDF 解析失败，请手动输入')
    }
  }

  profile = await askUserProfile(profile)

  // Step 3: GitHub data
  const { token, username, org } = await askGitHubCredentials()
  const octokit = createGitHubClient(token)

  const listSpinner = ora('拉取仓库列表...').start()
  let allRepos: { name: string; language: string | null }[] = []
  try {
    allRepos = await listOrgRepos(octokit, org, username)
    listSpinner.succeed(`找到 ${allRepos.length} 个仓库`)
  } catch (err) {
    listSpinner.fail('拉取仓库列表失败')
    console.error((err as Error).message)
    process.exit(1)
  }

  const selectedNames = await askRepoSelection(allRepos)

  // Ask company/period per repo (repos may span multiple employers)
  const repoMeta: Record<string, { company: string; period: string }> = {}
  for (const repoName of selectedNames) {
    console.log(chalk.dim(`\n配置仓库：${repoName}`))
    const { company: c, period: p } = await inquirer.prompt([
      { type: 'input', name: 'company', message: `  所属公司（如 即刻 iftechio）:`, default: org },
      { type: 'input', name: 'period', message: `  在职时间（如 2024.5 - 至今）:` },
    ])
    repoMeta[repoName] = { company: c.trim(), period: p.trim() }
  }

  const fetchSpinner = ora('拉取 PR 数据...').start()
  const repos: RepoData[] = []
  const failed: string[] = []

  for (const repoName of selectedNames) {
    try {
      fetchSpinner.text = `拉取 ${repoName}...`
      const { company, period } = repoMeta[repoName]
      const repoData = await buildRepoData(octokit, org, repoName, username, company, period)
      repos.push(repoData)
    } catch {
      failed.push(repoName)
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
