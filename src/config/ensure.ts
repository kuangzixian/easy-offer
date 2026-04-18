import { hasConfig, loadConfig } from './store.js'
import { runConfigWizard } from './wizard.js'

export async function ensureConfig(): Promise<void> {
  if (hasConfig()) return
  try {
    loadConfig()
    return
  } catch (err) {
    if (!process.stdin.isTTY) {
      console.error(`[config] ${(err as Error).message}`)
    }
  }
  await runConfigWizard()
}
