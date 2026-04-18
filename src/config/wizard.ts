import inquirer from 'inquirer'
import chalk from 'chalk'
import { configPath, hasConfig, loadConfigRaw, saveConfig, type LLMConfig } from './store.js'

export function maskKey(key: string): string {
  if (key.length < 8) return '***'
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

export async function runConfigWizard(): Promise<void> {
  const existing = hasConfig() ? loadConfigRaw() : null

  if (existing?.apiKey) {
    console.log(chalk.dim(`Current API key: ${maskKey(existing.apiKey)}`))
  }

  const answers = await inquirer.prompt<LLMConfig>([
    {
      type: 'input',
      name: 'baseURL',
      message: 'OpenAI-compatible API Base URL:',
      default: existing?.baseURL ?? 'https://api.openai.com/v1',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      mask: '*',
      validate: (v: string) => v.trim().length > 0 || 'API Key is required',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: existing?.model ?? 'gpt-4o-mini',
    },
  ])

  saveConfig({
    baseURL: answers.baseURL.trim(),
    apiKey: answers.apiKey.trim(),
    model: answers.model.trim(),
  })

  console.log(chalk.green(`✓ Config saved to ${configPath()}`))
}
