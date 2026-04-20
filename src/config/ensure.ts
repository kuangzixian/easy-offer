import inquirer from 'inquirer'
import ora from 'ora'
import chalk from 'chalk'
import { loadConfig } from './store.js'
import { runConfigWizard } from './wizard.js'
import { pingLLM, resetClient } from '../ai/client.js'

const MAX_ATTEMPTS = 3

export async function ensureConfig(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      loadConfig()
    } catch (err) {
      if (!process.stdin.isTTY) {
        console.error(`[config] ${(err as Error).message}`)
        process.exit(1)
      }
      await runConfigWizard()
      resetClient()
    }

    const spinner = ora('验证 LLM 配置...').start()
    try {
      await pingLLM()
      spinner.succeed('LLM 配置有效')
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      spinner.fail(`LLM 配置验证失败：${msg}`)

      if (!process.stdin.isTTY) process.exit(1)

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: '如何处理？',
        choices: [
          { name: '重新配置 LLM', value: 'reconfigure' },
          { name: '仍然继续（后续调用可能失败）', value: 'continue' },
          { name: '退出', value: 'exit' },
        ],
      }])

      if (action === 'exit') process.exit(1)
      if (action === 'continue') return
      await runConfigWizard()
      resetClient()
    }
  }
  console.error(chalk.red(`LLM 配置验证失败次数过多（${MAX_ATTEMPTS} 次），退出`))
  process.exit(1)
}
