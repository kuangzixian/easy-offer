import { Octokit } from '@octokit/rest'
import type { RepoData, PullRequest } from '../types.js'
import { extractTechStack } from './parser.js'
import { pMap } from '../utils/concurrency.js'

// GitHub Search API hard limits: 100/page, max 1000 results total → 10 pages.
const SEARCH_PER_PAGE = 100
const SEARCH_MAX_PAGES = 10
const PR_FETCH_CONCURRENCY = 5

export function createGitHubClient(token: string) {
  return new Octokit({ auth: token, userAgent: 'easy-offer/1.0' })
}

export interface DiscoveredRepo {
  owner: string
  name: string
  /** PR numbers belonging to the target user, merged within the date range. */
  prNumbers: number[]
}

export interface SearchResult {
  repos: DiscoveredRepo[]
  /** True when the GitHub Search API hit its 1000-result hard cap; some PRs may be missing. */
  truncated: boolean
}

export interface FetchRepoPRsResult {
  prs: PullRequest[]
  requestedCount: number
  failedCount: number
  skippedUnmergedCount: number
}

/**
 * Use GitHub Search to enumerate every merged PR by `username` between `from`
 * and `to`. Returns one entry per repo, including the PR numbers — the caller
 * can fetch only those numbers (avoiding paginating every PR in the repo).
 */
export async function searchUserPRRepos(
  octokit: Octokit,
  username: string,
  from: string,  // YYYY-MM-DD
  to: string,    // YYYY-MM-DD
): Promise<SearchResult> {
  const repoMap = new Map<string, DiscoveredRepo>()
  let truncated = false
  let page = 1

  while (page <= SEARCH_MAX_PAGES) {
    const { data } = await octokit.search.issuesAndPullRequests({
      q: `author:${username} type:pr is:merged merged:${from}..${to}`,
      per_page: SEARCH_PER_PAGE,
      page,
    })

    for (const item of data.items) {
      const m = item.repository_url.match(/\/repos\/([^/]+)\/([^/]+)$/)
      if (!m) continue
      const key = `${m[1]}/${m[2]}`
      let entry = repoMap.get(key)
      if (!entry) {
        entry = { owner: m[1], name: m[2], prNumbers: [] }
        repoMap.set(key, entry)
      }
      entry.prNumbers.push(item.number)
    }

    if (data.items.length < SEARCH_PER_PAGE) break
    page++

    // If the next page would exceed the cap AND the current page is full,
    // GitHub probably has more results we can't see.
    if (page > SEARCH_MAX_PAGES) {
      truncated = true
      break
    }
  }

  const repos = [...repoMap.values()].sort((a, b) => b.prNumbers.length - a.prNumbers.length)
  return { repos, truncated }
}

/**
 * Fetch full PR details (title + body + merge date) by PR number, in parallel
 * with bounded concurrency. Skips `pulls.listFiles` to keep API rate-limit usage low —
 * tech-stack extraction works fine off title + body for the vast majority of PRs.
 */
export async function fetchRepoPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumbers: readonly number[],
): Promise<PullRequest[]> {
  return (await fetchRepoPRsWithStats(octokit, owner, repo, prNumbers)).prs
}

export async function fetchRepoPRsWithStats(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumbers: readonly number[],
): Promise<FetchRepoPRsResult> {
  const results = await pMap(prNumbers, PR_FETCH_CONCURRENCY, async num => {
    try {
      const { data } = await octokit.pulls.get({ owner, repo, pull_number: num })
      if (!data.merged_at) return { status: 'unmerged' as const }
      const pr: PullRequest = {
        title: data.title,
        body: (data.body ?? '').slice(0, 2000),
        mergedAt: data.merged_at.slice(0, 10),
        filesChanged: [],  // intentionally empty; see comment above
      }
      return { status: 'ok' as const, pr }
    } catch {
      return { status: 'failed' as const }
    }
  })

  return {
    prs: results.flatMap(r => r.status === 'ok' ? [r.pr] : []),
    requestedCount: prNumbers.length,
    failedCount: results.filter(r => r.status === 'failed').length,
    skippedUnmergedCount: results.filter(r => r.status === 'unmerged').length,
  }
}

export async function buildRepoData(
  octokit: Octokit,
  owner: string,
  repoName: string,
  prNumbers: readonly number[],
  company: string,
  period: string,
): Promise<RepoData> {
  const result = await fetchRepoPRsWithStats(octokit, owner, repoName, prNumbers)

  if (prNumbers.length > 0 && result.prs.length === 0) {
    const detail = result.failedCount > 0
      ? `${result.failedCount}/${result.requestedCount} 个 PR 拉取失败`
      : `${result.skippedUnmergedCount}/${result.requestedCount} 个 PR 未处于已合并状态`
    throw new Error(`未能拉取 ${owner}/${repoName} 的有效 PR：${detail}`)
  }

  const techStack = extractTechStack(result.prs)
  return {
    name: repoName,
    org: owner,
    company,
    period,
    techStack,
    prs: result.prs,
    requestedPrCount: result.requestedCount,
    failedPrFetchCount: result.failedCount,
    skippedUnmergedPrCount: result.skippedUnmergedCount,
  }
}
