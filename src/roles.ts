import type { RoleKey } from './types.js'

export interface RoleConfig {
  key: RoleKey
  label: string
  keywords: string[]
  emphasis: string
}

export const ROLES: RoleConfig[] = [
  {
    key: 'go',
    label: 'Go 后端工程师',
    keywords: ['Go', 'gRPC', 'Kafka', '微服务', 'DDD', 'pprof', '高并发'],
    emphasis: '微服务架构、gRPC 服务治理、并发模型、性能调优（pprof）、DDD 分层架构',
  },
  {
    key: 'java',
    label: 'Java 后端工程师',
    keywords: ['Java', 'Spring', 'MySQL', '高并发', '分布式', 'JVM'],
    emphasis: '高并发系统设计、分布式架构、Spring 生态、JVM 调优',
  },
  {
    key: 'node',
    label: 'Node.js 工程师',
    keywords: ['Node.js', 'TypeScript', 'Express', 'Koa', 'SSE', 'WebSocket', 'AI'],
    emphasis: '异步模型、实时通信、AI 集成、流式响应、事件驱动',
  },
  {
    key: 'frontend',
    label: 'Web 前端工程师',
    keywords: ['React', 'Vue', 'TypeScript', 'webpack', 'vite', 'Core Web Vitals'],
    emphasis: '性能优化、框架深度、工程化体系、Core Web Vitals',
  },
  {
    key: 'ios',
    label: 'iOS 工程师',
    keywords: ['Swift', 'Objective-C', 'APNs', 'UIKit', 'SwiftUI'],
    emphasis: '原生开发、包体积优化、启动速度、APNs 推送',
  },
  {
    key: 'android',
    label: 'Android 工程师',
    keywords: ['Kotlin', 'Java', 'Jetpack', 'Compose', '内存优化'],
    emphasis: '原生开发、内存优化、Jetpack 组件、性能监控',
  },
  {
    key: 'fullstack',
    label: '全栈工程师',
    keywords: ['React', 'Node.js', 'TypeScript', 'MySQL', 'MongoDB'],
    emphasis: '前后端独立交付能力、全链路设计、产品思维',
  },
  {
    key: 'architect',
    label: '架构师',
    keywords: ['微服务', 'DDD', '系统设计', '可观测性', '高可用'],
    emphasis: '系统设计、技术决策、团队影响、可观测性体系、高可用架构',
  },
  {
    key: 'ai',
    label: 'AI/Agent 工程师',
    keywords: ['LLM', 'RAG', 'Prompt', 'Agent', 'Claude', 'OpenAI', '向量数据库'],
    emphasis: 'Prompt 工程、RAG 全流程、工具调用、幻觉处理、评估体系',
  },
]

export function getRoleConfig(key: RoleKey): RoleConfig {
  const role = ROLES.find(r => r.key === key)
  if (!role) throw new Error(`Unknown role: ${key}`)
  return role
}

/**
 * Score JD text against each role's keywords (case-insensitive substring match)
 * and return the highest-scoring role key. Used as a hint only — the user can
 * always override.
 */
export function inferRoleFromJD(jd: string): RoleKey {
  const scores: Record<RoleKey, number> = {
    go: 0, java: 0, node: 0, frontend: 0,
    ios: 0, android: 0, fullstack: 0, architect: 0, ai: 0,
  }
  const lower = jd.toLowerCase()
  for (const role of ROLES) {
    for (const kw of role.keywords) {
      if (lower.includes(kw.toLowerCase())) scores[role.key]++
    }
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return best[0] as RoleKey
}
