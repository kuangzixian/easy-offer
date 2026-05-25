import { writeFile, readFile } from 'fs/promises'
import { resolve } from 'path'
import { existsSync } from 'fs'
import ora from 'ora'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { readCache } from '../cache.js'
import { callLLM } from '../ai/client.js'
import { buildInterviewPrompt } from '../ai/prompt.js'
import { CliError } from '../utils/errors.js'

export async function runInterview(options: { output?: string }) {
  const outputDir = options.output ?? '.'
  const cache = await readCache(outputDir)

  // Load resume.md
  const mdPath = resolve(outputDir, 'resume.md')
  if (!existsSync(mdPath)) {
    throw new CliError('未找到 resume.md，请先运行 build')
  }
  const resumeContent = await readFile(mdPath, 'utf-8')

  // Get JD: prefer cached value, otherwise prompt the user.
  let jd = cache?.jd ?? null

  if (!jd) {
    const { wantJD } = await inquirer.prompt([{
      type: 'confirm',
      name: 'wantJD',
      message: '是否输入 JD 生成面试准备计划？',
      default: true,
    }])

    if (!wantJD) {
      console.log('已跳过面试准备计划生成')
      return
    }

    // Use the editor prompt for consistency with askTargetPosition — long
    // JDs in raw stdin readline are painful to paste/edit.
    const { jdInput } = await inquirer.prompt([{
      type: 'editor',
      name: 'jdInput',
      message: '在编辑器中粘贴 JD 内容（保存并关闭后继续）',
      waitUserInput: false,
    }])
    jd = (jdInput ?? '').trim()

    if (!jd) {
      console.log(chalk.yellow('JD 为空，已跳过面试准备计划生成'))
      return
    }
  } else {
    console.log(chalk.blue('✦ 使用 fetch 阶段已记录的 JD，直接生成面试准备计划'))
  }

  const spinner = ora('大模型正在分析岗位匹配度...').start()
  try {
    const prompt = buildInterviewPrompt(resumeContent, jd)
    const result = await callLLM('你是一位资深技术面试辅导专家。', prompt, 4000, {
      onRetry: ({ attempt, error }) => {
        spinner.text = `第 ${attempt} 次重试: ${error.message}`
      },
    })
    const outPath = resolve(outputDir, 'interview-prep.md')
    await writeFile(outPath, result, 'utf-8')
    spinner.succeed('interview-prep.md 已生成')
  } catch (err) {
    spinner.fail(`面试准备计划生成失败: ${(err as Error).message}`)
    // Don't throw CliError — interview is a "best-effort" step and shouldn't
    // bork the overall pipeline; just exit this command.
  }
}
