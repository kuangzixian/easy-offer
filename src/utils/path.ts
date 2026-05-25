import { homedir } from 'os'

/**
 * Expand a leading `~` to the user's home directory.
 * Returns the input unchanged if it doesn't start with `~/` or `~\`.
 */
export function expandHome(p: string): string {
  if (!p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return homedir() + p.slice(1)
  return p
}
