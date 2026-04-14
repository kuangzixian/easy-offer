#!/usr/bin/env node
import { program } from 'commander'
import { registerCommands } from './src/commands/index.js'

program
  .name('github-resume-gen')
  .description('Generate a tailored resume from your GitHub commit history')
  .version('1.0.0')

registerCommands(program)
program.parse()
