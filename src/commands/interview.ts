import { writeFile, readFile } from 'fs/promises'
import { resolve } from 'path'
import { existsSync } from 'fs'
import ora from 'ora'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { readCache } from '../cache.js'
import { callLLM } from '../ai/client.js'
import { buildInterviewPrompt } from '../ai/prompt.js'

export async function runInterview(options: { output?: string }) {
  const outputDir = options.output ?? '.'
  const cache = await readCache(outputDir)

  // Load resume.md
  const mdPath = resolve(outputDir, 'resume.md')
  if (!existsSync(mdPath)) {
    console.error(chalk.red('✗ 未找到 resume.md，请先运行 build'))
    process.exit(1)
  }
  const resumeContent = await readFile(mdPath, 'utf-8')

  // Get JD: use from cache or ask
  let jd = cache?.jd ?? null

  if (!jd) {
    const { wantJD } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantJD',
      message: '[步骤 5/5] 是否输入 JD 生成面试准备计划？',
      default: true,
    }])

    if (!wantJD) {
      console.log('已跳过面试准备计划生成')
      return
    }

    console.log('请粘贴 JD 内容，输入完成后单独一行输入 END 并回车：')
    const lines: string[] = []
    const rl = (await import('readline')).createInterface({ input: process.stdin })
    try {
      await new Promise<void>(resolveP => {
        rl.on('line', line => {
          if (line.trim() === 'END') { resolveP() }
          else lines.push(line)
        })
      })
    } finally {
      rl.close()
    }
    jd = lines.join('\n')
  } else {
    console.log(chalk.blue('✦ 使用步骤 0 已记录的 JD，直接生成面试准备计划'))
  }

  const spinner = ora('大模型正在分析岗位匹配度...').start()
  try {
    const prompt = buildInterviewPrompt(resumeContent, jd)
    const result = await callLLM('你是一位资深技术面试辅导专家。', prompt, 4000)
    const outPath = resolve(outputDir, 'interview-prep.md')
    await writeFile(outPath, result, 'utf-8')
    spinner.succeed('interview-prep.md 已生成')
  } catch (err) {
    spinner.fail(`面试准备计划生成失败: ${(err as Error).message}`)
    return
  }
}
