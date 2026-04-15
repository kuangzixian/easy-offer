import inquirer from 'inquirer'
import ora from 'ora'
import chalk from 'chalk'
import { ROLES } from '../config.js'
import { extractJDFromImage } from '../ocr/vision.js'
import type { RoleKey, WorkExperience, UserProfile } from '../types.js'

export async function askTargetPosition(): Promise<{ position: string; jd: string | null }> {
  const { position } = await inquirer.prompt([{
    type: 'input',
    name: 'position',
    message: '[步骤 0/5] 你在面试哪个岗位？（可选，回车跳过）',
  }])

  if (!position.trim()) return { position: '', jd: null }

  const { jdMethod } = await inquirer.prompt([{
    type: 'list',
    name: 'jdMethod',
    message: '是否提供 JD？',
    choices: [
      { name: '提供截图路径（Claude Vision OCR）', value: 'ocr' },
      { name: '手动粘贴文字', value: 'manual' },
      { name: '跳过', value: 'skip' },
    ],
  }])

  if (jdMethod === 'skip') return { position: position.trim(), jd: null }

  if (jdMethod === 'ocr') {
    const { imgPath } = await inquirer.prompt([{
      type: 'input',
      name: 'imgPath',
      message: '请输入截图文件路径（支持 JPEG/PNG/GIF/WEBP）:',
      validate: (v: string) => v.trim().length > 0 || '路径不能为空',
    }])

    const spinner = ora('正在识别图片...').start()
    try {
      const extracted = await extractJDFromImage(imgPath.trim())
      spinner.succeed('识别完成')

      // Show preview: first 3 non-empty lines
      const preview = extracted.split('\n').filter(l => l.trim()).slice(0, 3).join('\n')
      console.log(chalk.dim('\n识别结果预览：\n' + preview + '\n'))

      const { confirmed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmed',
        message: '识别结果是否正确？',
        default: true,
      }])

      if (confirmed) return { position: position.trim(), jd: extracted }

      console.log(chalk.yellow('请改用手动粘贴'))
      // fall through to manual paste below
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err))
      console.log(chalk.yellow('将改为手动粘贴'))
      // fall through to manual paste below
    }
  }

  // Manual paste (option 2, or fallback from OCR)
  console.log('请粘贴 JD 内容，输入完成后单独一行输入 END 并回车：')
  const lines: string[] = []
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin })
  try {
    await new Promise<void>(resolveP => {
      rl.on('line', line => {
        if (line.trim() === 'END') { resolveP() }
        else lines.push(line)
      })
      rl.once('close', resolveP)
    })
  } finally {
    rl.close()
  }

  const jdText = lines.join('\n').trim()
  return { position: position.trim(), jd: jdText || null }
}

export async function askRole(inferredRole?: RoleKey): Promise<RoleKey> {
  const choices = ROLES.map(r => ({
    name: r.key === inferredRole ? `${r.label}（推荐，与 JD 匹配）` : r.label,
    value: r.key,
  }))

  if (inferredRole) {
    const idx = choices.findIndex(c => c.value === inferredRole)
    if (idx > 0) choices.unshift(choices.splice(idx, 1)[0])
  }

  const { role } = await inquirer.prompt([{
    type: 'list',
    name: 'role',
    message: '[步骤 1/5] 确认目标工种：',
    choices,
    default: inferredRole,
  }])

  return role as RoleKey
}

export async function askPDFPath(): Promise<string> {
  const { path } = await inquirer.prompt([{
    type: 'input',
    name: 'path',
    message: '[步骤 2/5] 旧简历 PDF 路径（回车跳过）:',
  }])
  return path.trim()
}

export async function askUserProfile(): Promise<UserProfile> {
  return inquirer.prompt([
    { type: 'input', name: 'name', message: '姓名:' },
    { type: 'input', name: 'phone', message: '手机号:' },
    { type: 'input', name: 'email', message: '邮箱:' },
    { type: 'input', name: 'github', message: 'GitHub 用户名（可选）:' },
  ])
}

export async function askGitHubCredentials(): Promise<{ token: string; username: string; org: string }> {
  const token = process.env.GITHUB_TOKEN
  const result: Record<string, string> = {}

  if (!token) {
    const { t } = await inquirer.prompt([{
      type: 'password',
      name: 't',
      message: 'GitHub Personal Access Token:',
    }])
    result.token = t
  } else {
    result.token = token
    console.log('✓ 使用环境变量 GITHUB_TOKEN')
  }

  const rest = await inquirer.prompt([
    { type: 'input', name: 'username', message: 'GitHub 用户名:' },
    { type: 'input', name: 'org', message: '所属组织 (org):' },
  ])

  return { token: result.token, ...rest }
}

export async function askRepoSelection(
  repos: { name: string; language: string | null; prCount?: number }[],
): Promise<string[]> {
  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: '[步骤 3/5] 选择要纳入简历的仓库:',
    choices: repos.map(r => ({
      name: `${r.name} (${r.language ?? 'unknown'}${r.prCount != null ? `, ${r.prCount} PRs` : ''})`,
      value: r.name,
    })),
    validate: (ans: string[]) => ans.length > 0 || '请至少选择一个仓库',
  }])
  return selected
}

export async function confirmWorkHistory(experiences: WorkExperience[]): Promise<WorkExperience[]> {
  console.log('\n检测到以下工作经历：')
  experiences.forEach((e, i) => console.log(`  ${i + 1}. ${e.company}  ${e.period}`))

  const { confirmed } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirmed',
    message: '以上信息是否正确？',
    default: true,
  }])

  if (confirmed) return experiences

  const { count } = await inquirer.prompt([{
    type: 'number',
    name: 'count',
    message: '请输入工作经历条数:',
    default: experiences.length,
  }])

  const manual: WorkExperience[] = []
  for (let i = 0; i < (count as number); i++) {
    const entry = await inquirer.prompt([
      { type: 'input', name: 'company', message: `第 ${i + 1} 段 - 公司名:` },
      { type: 'input', name: 'title', message: `第 ${i + 1} 段 - 职位:` },
      { type: 'input', name: 'period', message: `第 ${i + 1} 段 - 时间:` },
    ])
    manual.push({ ...entry, source: 'manual' })
  }
  return manual
}
