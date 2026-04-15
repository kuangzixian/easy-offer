import type { Command } from 'commander'
import { runFetch } from './fetch.js'
import { runBuild } from './build.js'
import { runInterview } from './interview.js'

export function registerCommands(program: Command): void {
  // Main interactive flow: runs all steps
  program
    .command('run', { isDefault: true })
    .description('Interactive full flow: fetch → build → interview prep')
    .option('-o, --output <dir>', 'Output directory', '.')
    .action(async (opts: { output?: string }) => {
      await runFetch(opts)
      await runBuild(opts)
      await runInterview(opts)
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('  完成！输出文件：')
      console.log('  📄 resume.md')
      console.log('  📄 resume.pdf')
      console.log('  📋 interview-prep.md')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    })

  program
    .command('fetch')
    .description('Fetch GitHub PR data and cache locally')
    .option('-o, --output <dir>', 'Output directory', '.')
    .action(runFetch)

  program
    .command('build')
    .description('Generate resume.md and resume.pdf from cache')
    .option('-o, --output <dir>', 'Output directory', '.')
    .option('--no-pdf', 'Skip PDF generation')
    .action(runBuild)

  program
    .command('interview')
    .description('Generate interview-prep.md from resume.md and JD')
    .option('-o, --output <dir>', 'Output directory', '.')
    .action(runInterview)
}
