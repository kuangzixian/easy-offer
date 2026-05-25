import type { PullRequest } from '../types.js'

const TECH_KEYWORDS = [
  'Go', 'gRPC', 'Kafka', 'Redis', 'MySQL', 'MongoDB', 'PostgreSQL',
  'TypeScript', 'JavaScript', 'Node.js', 'React', 'Vue', 'Python',
  'Java', 'Kotlin', 'Swift', 'Docker', 'Kubernetes', 'Elasticsearch',
  'RabbitMQ', 'SocketIO', 'WebSocket', 'SSE', 'REST', 'GraphQL',
  'DDD', 'Protobuf', 'ZooKeeper', 'Nginx', 'Jenkins', 'Drone',
  'Prometheus', 'Grafana', 'pprof', 'OpenAI', 'Claude', 'LLM', 'RAG',
]

const REGEX_META = /[.*+?^${}()|[\]\\]/g

/**
 * Build a case-insensitive matcher for `keyword` that won't match when the
 * keyword is embedded inside a larger alphanumeric token.
 *
 * Examples:
 *   "Go"      ✗ "google", "going", "logout"        ✓ "Go and Rust", "uses Go."
 *   "Java"    ✗ "javascript"                        ✓ "Java 11"
 *   "Node.js" ✗ "Node.jsfoo"                        ✓ "Node.js 18"
 *
 * Standard `\b` doesn't help for keywords with non-word chars like the dot in
 * "Node.js", so we use explicit lookarounds against `[A-Za-z0-9]`.
 */
function buildKeywordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(REGEX_META, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i')
}

const KEYWORD_PATTERNS: { keyword: string; pattern: RegExp }[] =
  TECH_KEYWORDS.map(k => ({ keyword: k, pattern: buildKeywordRegex(k) }))

export function extractTechStack(prs: PullRequest[]): string[] {
  const found = new Set<string>()
  const allText = prs.map(p => `${p.title} ${p.body} ${p.filesChanged.join(' ')}`).join(' ')
  for (const { keyword, pattern } of KEYWORD_PATTERNS) {
    if (pattern.test(allText)) found.add(keyword)
  }
  return [...found]
}

export function summarizePRs(prs: PullRequest[]): string[] {
  return prs.map(pr => {
    const body = pr.body.length > 500 ? pr.body.slice(0, 500) + '...' : pr.body
    return `[${pr.mergedAt}] ${pr.title}: ${body}`
  })
}
