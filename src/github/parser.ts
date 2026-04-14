import type { PullRequest } from '../types.js'

const TECH_KEYWORDS = [
  'Go', 'gRPC', 'Kafka', 'Redis', 'MySQL', 'MongoDB', 'PostgreSQL',
  'TypeScript', 'JavaScript', 'Node.js', 'React', 'Vue', 'Python',
  'Java', 'Kotlin', 'Swift', 'Docker', 'Kubernetes', 'Elasticsearch',
  'RabbitMQ', 'SocketIO', 'WebSocket', 'SSE', 'REST', 'GraphQL',
  'DDD', 'Protobuf', 'ZooKeeper', 'Nginx', 'Jenkins', 'Drone',
  'Prometheus', 'Grafana', 'pprof', 'OpenAI', 'Claude', 'LLM', 'RAG',
]

export function extractTechStack(prs: PullRequest[]): string[] {
  const found = new Set<string>()
  const allText = prs.map(p => `${p.title} ${p.body} ${p.filesChanged.join(' ')}`).join(' ')
  for (const kw of TECH_KEYWORDS) {
    if (allText.toLowerCase().includes(kw.toLowerCase())) {
      found.add(kw)
    }
  }
  return [...found]
}

export function summarizePRs(prs: PullRequest[]): string[] {
  return prs.map(pr => {
    const body = pr.body.length > 500 ? pr.body.slice(0, 500) + '...' : pr.body
    return `[${pr.mergedAt}] ${pr.title}: ${body}`
  })
}
