import { Octokit } from '@octokit/rest'
import type { RepoData, PullRequest } from '../types.js'
import { extractTechStack } from './parser.js'

export function createGitHubClient(token: string) {
  return new Octokit({ auth: token })
}

export interface DiscoveredRepo {
  owner: string
  name: string
  prCount: number
}

export async function searchUserPRRepos(
  octokit: Octokit,
  username: string,
  from: string,  // YYYY-MM-DD
  to: string,    // YYYY-MM-DD
): Promise<DiscoveredRepo[]> {
  const counts = new Map<string, number>()
  let page = 1
  const MAX_PAGES = 10  // GitHub search caps at 1000 results
  while (page <= MAX_PAGES) {
    const { data } = await octokit.search.issuesAndPullRequests({
      q: `author:${username} type:pr is:merged merged:${from}..${to}`,
      per_page: 100,
      page,
    })
    for (const item of data.items) {
      const m = item.repository_url.match(/\/repos\/([^/]+)\/([^/]+)$/)
      if (!m) continue
      const key = `${m[1]}/${m[2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (data.items.length < 100) break
    page++
  }
  return [...counts.entries()]
    .map(([key, prCount]) => {
      const [owner, name] = key.split('/')
      return { owner, name, prCount }
    })
    .sort((a, b) => b.prCount - a.prCount)
}

export async function fetchRepoPRs(
  octokit: Octokit,
  org: string,
  repo: string,
  username: string,
  since?: string,
): Promise<PullRequest[]> {
  const prs: PullRequest[] = []
  let page = 1
  while (prs.length < 100) {
    const { data } = await octokit.pulls.list({
      owner: org,
      repo,
      state: 'closed',
      per_page: 50,
      page,
      sort: 'updated',
      direction: 'desc',
    })
    if (data.length === 0) break

    for (const pr of data) {
      // Only include PRs by the target user that are merged
      if (pr.user?.login !== username) continue
      if (!pr.merged_at) continue
      if (since && pr.merged_at < since) continue

      // Fetch changed files
      const { data: files } = await octokit.pulls.listFiles({
        owner: org, repo, pull_number: pr.number, per_page: 100,
      })

      const body = (pr.body ?? '').slice(0, 2000)
      prs.push({
        title: pr.title,
        body,
        mergedAt: pr.merged_at.slice(0, 10),
        filesChanged: files.map(f => f.filename),
      })
    }
    page++
    if (data.length < 50) break
  }
  return prs
}

export async function buildRepoData(
  octokit: Octokit,
  org: string,
  repoName: string,
  username: string,
  company: string,
  period: string,
  since?: string,
): Promise<RepoData> {
  const prs = await fetchRepoPRs(octokit, org, repoName, username, since)
  const techStack = extractTechStack(prs)
  return { name: repoName, org, company, period, techStack, prs }
}
