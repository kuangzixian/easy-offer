#!/usr/bin/env node
import { program } from 'commander'
import chalk from 'chalk'
import { registerCommands } from './src/commands/index.js'
import { ensureConfig } from './src/config/ensure.js'
import { CliError } from './src/utils/errors.js'

program
  .name('easy-offer')
  .description('Generate a tailored resume from your GitHub commit history')
  .version('1.0.0')

registerCommands(program)

async function main() {
  // Skip ensureConfig when the user is running `config` itself,
  // otherwise a broken config could never be fixed.
  const subcommand = process.argv[2]
  if (subcommand !== 'config') {
    await ensureConfig()
  }
  await program.parseAsync()
}

main().catch(err => {
  if (err instanceof CliError) {
    console.error(chalk.red(`✗ ${err.message}`))
    process.exit(err.exitCode)
  }
  console.error(err)
  process.exit(1)
})
