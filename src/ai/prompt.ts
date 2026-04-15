import { getRoleConfig } from '../config.js'
import type { RepoData, RoleKey } from '../types.js'

const RESUME_RULES = `
你是一位专业的技术简历撰写专家。请严格遵守以下规则：
- 使用"问题-方案-结果"结构描述每个模块
- 不写代码行数、PR 数量、提交次数
- 使用架构级术语（DDD、事件驱动、断路器、熔断机制等）
- 不写"精通"，用"主力使用"或"生产环境 N 年"
- 不写自我评价（热爱学习、责任心强等）
- 结果必须量化（性能提升、用户规模、服务可用性）
- 若无量化数据，写工程规模（模块数、文件数）
`

export function buildResumePrompt(
  repo: RepoData,
  role: RoleKey,
  jd: string | null,
): { system: string; user: string } {
  const roleConfig = getRoleConfig(role)

  const system = `${RESUME_RULES}
该候选人的目标岗位侧重：${roleConfig.emphasis}
重点包装这些技术关键词：${roleConfig.keywords.join('、')}
`

  const prSummary = repo.prs
    .slice(0, 30)
    .map(pr => `- [${pr.mergedAt}] ${pr.title}\n  ${pr.body.slice(0, 300)}`)
    .join('\n')

  const jdSection = jd
    ? `\n## 目标 JD（请让简历描述与此对齐）\n${jd.slice(0, 1000)}\n`
    : ''

  const user = `请为以下仓库生成简历项目经验段落。

## 仓库信息
- 名称：${repo.name}
- 公司：${repo.company}
- 时间：${repo.period}
- 技术栈：${repo.techStack.join('、')}
${jdSection}
## PR 记录（最近 ${repo.prs.slice(0, 30).length} 条）
${prSummary}

## 输出格式
### ${repo.name}（${repo.period}）
**技术栈**：[列出主要技术]

**核心职责**：
- **[模块名]**：[问题背景 + 技术方案 + 量化结果]
- ...
`

  return { system, user }
}

export function buildInterviewPrompt(resumeContent: string, jd: string): string {
  return `你是一位资深技术面试辅导专家。根据候选人简历和目标 JD，生成详细的面试准备计划。

## 候选人简历
${resumeContent}

## 目标 JD
${jd}

## 输出格式（Markdown）

# 面试准备计划

## 一、岗位匹配分析
- **强匹配点**：简历中哪些经历直接对口 JD 要求
- **潜在短板**：JD 要求但简历较弱的地方
- **建议重点包装的项目**：

## 二、高频技术面试题（按优先级）
### 必考题（JD 直接提到的技术）
- Q: ... 参考回答角度: ...

### 大概率考（基于你的项目经历）
- Q: ... 参考回答角度: ...

## 三、项目追问准备
### [项目名]
- 可能被追问：...
- 建议准备：技术细节 / 挑战 / 数据支撑

## 四、知识点补充建议（按优先级）

## 五、面试策略
- 自我介绍侧重点
- 需要主动展开讲的亮点
`
}

export function buildRoleInferencePrompt(jd: string): string {
  return `根据以下 JD，判断最匹配的岗位类型，只返回一个 key，不要解释：
可选值：go / java / node / frontend / ios / android / fullstack / architect / ai

JD：
${jd.slice(0, 500)}`
}
