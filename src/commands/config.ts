import { runConfigWizard } from '../config/wizard.js'
import { resetClient } from '../ai/client.js'

export async function runConfig(): Promise<void> {
  await runConfigWizard()
  resetClient()
}
