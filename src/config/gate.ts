export function shouldEnsureConfig(argv: readonly string[]): boolean {
  if (argv.includes('--help') || argv.includes('-h')) return false
  if (argv.includes('--version') || argv.includes('-V')) return false
  if (argv[0] === 'help' || argv[0] === 'config') return false
  return true
}
