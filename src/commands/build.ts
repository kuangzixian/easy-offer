import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import ora from 'ora'
import chalk from 'chalk'
import { readCache } from '../cache.js'
import { callClaude } from '../ai/client.js'
import { buildResumePrompt } from '../ai/prompt.js'
import { markdownToPDF } from '../pdf/writer.js'
import type { RoleKey } from '../types.js'

export async function runBuild(options: { output?: string; noPdf?: boolean }) {
  const outputDir = options.output ?? '.'
  const cache = await readCache(outputDir)

  if (!cache) {
    console.error(chalk.red('✗ 未找到缓存文件，请先运行 fetch'))
    process.exit(1)
  }

  if (cache.jd) {
    console.log(chalk.blue('✦ 检测到 JD，简历将对齐 JD 关键词'))
  }

  // Generate project sections per repo
  const sections: string[] = []
  const failed: string[] = []

  for (const repo of cache.repos) {
    const spinner = ora(`Claude 正在分析 ${repo.name}...`).start()
    try {
      const { system, user } = buildResumePrompt(repo, cache.role as RoleKey, cache.jd)
      const result = await callClaude(system, user)
      sections.push(result)
      spinner.succeed(`${repo.name} 完成`)
    } catch (err) {
      spinner.fail(`${repo.name} 失败，已跳过`)
      sections.push(`<!-- TODO: ${repo.name} 生成失败，请手动补充 -->`)
      failed.push(repo.name)
    }
  }

  // Assemble full resume
  const techStackAll = [...new Set(cache.repos.flatMap(r => r.techStack))]
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
