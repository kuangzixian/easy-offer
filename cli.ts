#!/usr/bin/env node
import { program } from 'commander'
import { registerCommands } from './src/commands/index.js'
import { ensureConfig } from './src/config/ensure.js'

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
  program.parse()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
