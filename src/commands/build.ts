import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import ora from 'ora'
import chalk from 'chalk'
import { readCache } from '../cache.js'
import { callLLM } from '../ai/client.js'
import { buildResumePrompt } from '../ai/prompt.js'
import { markdownToPDF } from '../pdf/writer.js'
import { ROLES } from '../roles.js'
import { askReposToInclude } from '../interactive/questions.js'
import { CliError } from '../utils/errors.js'
import { pMap } from '../utils/concurrency.js'
import type { RoleKey } from '../types.js'

const LLM_CONCURRENCY = 3

export async function runBuild(options: { output?: string; noPdf?: boolean }) {
  const outputDir = options.output ?? '.'
  const cache = await readCache(outputDir)

  if (!cache) {
    throw new CliError('未找到缓存文件，请先运行 fetch')
  }

  if (!ROLES.some(r => r.key === cache.role)) {
    throw new CliError(`缓存中的工种 "${cache.role}" 无效，请重新运行 fetch`)
  }

  if (cache.repos.length === 0) {
    throw new CliError('缓存中没有仓库数据，请先运行 fetch 并选择至少一个仓库')
  }

  if (cache.jd) {
    console.log(chalk.blue('✦ 检测到 JD，简历将对齐 JD 关键词'))
  }

  // Let user curate which repos to include
  const selected = await askReposToInclude(
    cache.repos.map(r => ({
      key: `${r.org}/${r.name}`,
      name: r.name,
      org: r.org,
      company: r.company,
      period: r.period,
      prCount: r.prs.length,
    })),
  )
  const selectedSet = new Set(selected)
  const includedRepos = cache.repos.filter(r => selectedSet.has(`${r.org}/${r.name}`))

  if (includedRepos.length === 0) {
    throw new CliError('未选择任何项目，退出')
  }

  // Generate project sections in parallel with bounded concurrency.
  // A single shared spinner gives a clean view of multi-repo progress
  // (per-repo spinners would garble the terminal under concurrency).
  const total = includedRepos.length
  let completed = 0
  let lastDone = ''
  const spinner = ora(`大模型分析 0/${total} 个仓库...`).start()

  const results = await pMap(includedRepos, LLM_CONCURRENCY, async repo => {
    const { system, user } = buildResumePrompt(repo, cache.role as RoleKey, cache.jd)
    try {
      const content = await callLLM(system, user, 2000, {
        onRetry: ({ attempt, error }) => {
          spinner.text = `大模型分析 ${completed}/${total}（${repo.name} 第 ${attempt} 次重试: ${error.message}）`
        },
      })
      completed++
      lastDone = repo.name
      spinner.text = `大模型分析 ${completed}/${total} 个仓库（最近完成: ${lastDone}）`
      return { name: repo.name, content, ok: true as const }
    } catch (err) {
      completed++
      const msg = err instanceof Error ? err.message : String(err)
      spinner.text = `大模型分析 ${completed}/${total}（${repo.name} 失败: ${msg}）`
      return {
        name: repo.name,
        content: `<!-- TODO: ${repo.name} 生成失败：${msg}，请手动补充 -->`,
        ok: false as const,
      }
    }
  })

  const failed = results.filter(r => !r.ok).map(r => r.name)
  if (failed.length > 0) {
    spinner.warn(`分析完成，${total - failed.length}/${total} 成功，${failed.length} 失败`)
  } else {
    spinner.succeed(`分析完成，${total}/${total} 成功`)
  }

  // Assemble full resume
  const sections = results.map(r => r.content)
  const techStackAll = [...new Set(includedRepos.flatMap(r => r.techStack))]
  const workHistory = cache.existingExperience
    .map(e => `- **${e.title}** | ${e.company} | ${e.period}`)
    .join('\n')

  const resumeMd = `# ${cache.profile.name || cache.username}

**电话**: ${cache.profile.phone || ''} | **邮箱**: ${cache.profile.email || ''}${cache.profile.github ? ` | **GitHub**: ${cache.profile.github}` : ''}

---

## 技术栈

${techStackAll.join('、')}

---

## 工作经历

${workHistory}

---

## 项目经验

${sections.join('\n\n---\n\n')}

---

## 教育背景

${cache.education}
`

  const mdPath = resolve(outputDir, 'resume.md')
  await mkdir(outputDir, { recursive: true })
  await writeFile(mdPath, resumeMd, 'utf-8')
  console.log(chalk.green(`\n✓ resume.md 已生成`))

  if (!options.noPdf) {
    const pdfSpinner = ora('生成 PDF...').start()
    try {
      await markdownToPDF(resumeMd, resolve(outputDir, 'resume.pdf'))
      pdfSpinner.succeed('resume.pdf 已生成')
    } catch (err) {
      pdfSpinner.fail(`PDF 生成失败: ${(err as Error).message}`)
    }
  }

  if (failed.length > 0) {
    console.log(chalk.yellow(`\n⚠ 以下仓库生成失败，已插入占位符：${failed.join(', ')}`))
  }
}
