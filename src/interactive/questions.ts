import inquirer from 'inquirer'
import { execSync } from 'child_process'
import ora from 'ora'
import chalk from 'chalk'
import { ROLES } from '../config.js'
import { extractJDFromImage } from '../ocr/vision.js'
import { cleanOCRText } from '../ocr/cleanup.js'
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
      { name: '提供截图路径（本地 OCR，tesseract.js）', value: 'ocr' },
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

    const spinner = ora('正在识别图片（首次运行会下载中文语言包，约 15MB）...').start()
    try {
      const extracted = await extractJDFromImage(imgPath.trim(), pct => {
        spinner.text = `识别中 ${pct}%`
      })

      let preview = extracted
      spinner.text = '正在用大模型清洗 OCR 噪声...'
      try {
        preview = await cleanOCRText(extracted)
        spinner.succeed('识别 + 清洗完成，接下来请在编辑器中校对')
      } catch (cleanupErr) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
        spinner.warn(`OCR 清洗失败（${msg}），用原始识别结果继续`)
      }

      const { jd } = await inquirer.prompt([{
        type: 'editor',
        name: 'jd',
        message: '请校对/修正 OCR 文本（保存并关闭编辑器后继续）',
        default: preview,
        waitUserInput: false,
      }])

      const cleaned = (jd ?? '').trim()
      if (cleaned) return { position: position.trim(), jd: cleaned }

      console.log(chalk.yellow('校对后内容为空，改为手动粘贴'))
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err))
      console.log(chalk.yellow('将改为手动粘贴'))
    }
  }

  // Manual paste (option 2, or fallback from OCR)
  console.log('请粘贴 JD 内容，输入完成后单独一行输入 END 并回车：')
  const lines: string[] = []
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin })
  try {
    await new Promise<void>(resolveP => {
      const onLine = (line: string) => {
        if (line.trim() === 'END') {
          rl.removeListener('line', onLine)
          resolveP()
        } else {
          lines.push(line)
        }
      }
      rl.on('line', onLine)
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

export async function askUserProfile(defaults: Partial<UserProfile> = {}): Promise<UserProfile> {
  return inquirer.prompt([
    { type: 'input', name: 'name', message: '姓名:', default: defaults.name },
    { type: 'input', name: 'phone', message: '手机号:', default: defaults.phone },
    { type: 'input', name: 'email', message: '邮箱:', default: defaults.email },
    { type: 'input', name: 'github', message: 'GitHub 用户名（可选）:', default: defaults.github },
  ])
}

function getGhCliToken(): { token: string; username: string } | null {
  try {
    const token = execSync('gh auth token', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    if (!token) return null
    const username = execSync('gh api user --jq \'.login\'', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    return { token, username }
  } catch {
    return null
  }
}

export async function askGitHubCredentials(): Promise<{ token: string; username: string }> {
  let token = ''
  let detectedUsername = ''

  if (process.env.GITHUB_TOKEN) {
    token = process.env.GITHUB_TOKEN
    console.log('✓ 使用环境变量 GITHUB_TOKEN')
  } else {
    const ghCli = getGhCliToken()
    if (ghCli) {
      token = ghCli.token
      detectedUsername = ghCli.username
      console.log(`✓ 使用 gh CLI 凭证（${detectedUsername}）`)
    } else {
      const { t } = await inquirer.prompt([{
        type: 'password',
        name: 't',
        message: 'GitHub Personal Access Token:',
      }])
      token = t
    }
  }

  let username = detectedUsername
  if (!username) {
    const { u } = await inquirer.prompt([{ type: 'input', name: 'u', message: 'GitHub 用户名:' }])
    username = u
  }

  return { token, username }
}

export async function askDateRange(
  suggestedFrom?: string,
  suggestedTo?: string,
): Promise<{ from: string; to: string }> {
  const today = new Date().toISOString().slice(0, 10)
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'from',
      message: '起始时间 (YYYY-MM-DD):',
      default: suggestedFrom ?? '2018-01-01',
      validate: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) || '格式: YYYY-MM-DD',
    },
    {
      type: 'input',
      name: 'to',
      message: '截止时间 (YYYY-MM-DD):',
      default: suggestedTo ?? today,
      validate: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) || '格式: YYYY-MM-DD',
    },
  ])
  return { from: answers.from.trim(), to: answers.to.trim() }
}

export async function askReposToInclude(
  repos: { name: string; company: string; period: string; prCount: number }[],
): Promise<string[]> {
  if (repos.length === 0) return []
  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: '选择要写入简历的项目经历（空格切换，回车确认）:',
    choices: repos.map(r => ({
      name: `[${r.company || '未分类'} ${r.period || '-'}] ${r.name} (${r.prCount} PRs)`,
      value: r.name,
      checked: true,
    })),
    validate: (ans: string[]) => ans.length > 0 || '请至少保留一个项目',
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
