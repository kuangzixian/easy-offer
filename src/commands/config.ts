import { runConfigWizard } from '../config/wizard.js'

export async function runConfig(): Promise<void> {
  await runConfigWizard()
}
