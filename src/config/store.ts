import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

export class ConfigMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigMissingError'
  }
}

export function configPath(): string {
  return join(process.env.HOME ?? homedir(), '.easy-offer', 'config.json')
}

export function hasConfig(): boolean {
  return existsSync(configPath())
}

export function loadConfigRaw(): LLMConfig | null {
  if (!hasConfig()) return null
  const path = configPath()
  let parsed: any
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}. Delete it or run 'easy-offer config'.`)
  }
  return {
    baseURL: parsed.baseURL ?? '',
    apiKey: parsed.apiKey ?? '',
    model: parsed.model ?? '',
  }
}

export function loadConfig(): LLMConfig {
  const fromFile = loadConfigRaw()
  const merged: LLMConfig = {
    baseURL: process.env.OPENAI_BASE_URL ?? fromFile?.baseURL ?? '',
    apiKey:  process.env.OPENAI_API_KEY  ?? fromFile?.apiKey  ?? '',
    model:   process.env.OPENAI_MODEL    ?? fromFile?.model   ?? '',
  }
  const missing = (['baseURL', 'apiKey', 'model'] as const).filter(k => !merged[k])
  if (missing.length > 0) {
    throw new ConfigMissingError(
      `Missing config field(s): ${missing.join(', ')}. ` +
      `Run 'easy-offer config' or set OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL.`,
    )
  }
  return merged
}

export function saveConfig(cfg: LLMConfig): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8')
  chmodSync(path, 0o600)
}
