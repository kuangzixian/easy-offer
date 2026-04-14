import { Octokit } from '@octokit/rest'
import type { RepoData, PullRequest } from '../types.js'
import { extractTechStack } from './parser.js'

export function createGitHubClient(token: string) {
  return new Octokit({ auth: token })
}

export async function listOrgRepos(
  octokit: Octokit,
  org: string,
  username: string,
): Promise<{ name: string; language: string | null }[]> {
  const repos: { name: string; language: string | null }[] = []
  let page = 1
  while (true) {
    const { data } = await octokit.repos.listForOrg({ org, per_page: 100, page })
    if (data.length === 0) break
    repos.push(...data.map(r => ({ name: r.name, language: r.language ?? null })))
    page++
  }
  return repos
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
