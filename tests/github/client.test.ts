import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  searchUserPRRepos,
  fetchRepoPRs,
  fetchRepoPRsWithStats,
  buildRepoData,
  type DiscoveredRepo,
} from '../../src/github/client.js'

type MockOctokit = {
  search: { issuesAndPullRequests: ReturnType<typeof vi.fn> }
  pulls: { get: ReturnType<typeof vi.fn> }
}

function makeOctokit(): MockOctokit {
  return {
    search: { issuesAndPullRequests: vi.fn() },
    pulls: { get: vi.fn() },
  }
}

function searchPage(items: { number: number; repo: string }[]) {
  return {
    data: {
      items: items.map(({ number, repo }) => ({
        number,
        repository_url: `https://api.github.com/repos/${repo}`,
      })),
    },
  }
}

describe('searchUserPRRepos', () => {
  let octokit: MockOctokit

  beforeEach(() => {
    octokit = makeOctokit()
  })

  it('groups PRs by owner/repo and returns PR numbers', async () => {
    octokit.search.issuesAndPullRequests.mockResolvedValueOnce(
      searchPage([
        { number: 1, repo: 'org/a' },
        { number: 2, repo: 'org/a' },
        { number: 3, repo: 'org/b' },
      ]),
    )

    const result = await searchUserPRRepos(octokit as any, 'me', '2024-01-01', '2024-12-31')
    expect(result.truncated).toBe(false)
    expect(result.repos).toHaveLength(2)
    const repoA = result.repos.find(r => r.name === 'a')!
    expect(repoA.owner).toBe('org')
    expect(repoA.prNumbers.sort()).toEqual([1, 2])
    expect(result.repos.find(r => r.name === 'b')!.prNumbers).toEqual([3])
  })

  it('sorts results by PR count descending', async () => {
    octokit.search.issuesAndPullRequests.mockResolvedValueOnce(
      searchPage([
        { number: 1, repo: 'org/small' },
        { number: 2, repo: 'org/big' },
        { number: 3, repo: 'org/big' },
        { number: 4, repo: 'org/big' },
      ]),
    )
    const { repos } = await searchUserPRRepos(octokit as any, 'me', '2024-01-01', '2024-12-31')
    expect(repos.map(r => r.name)).toEqual(['big', 'small'])
  })

  it('builds the correct search query string', async () => {
    octokit.search.issuesAndPullRequests.mockResolvedValueOnce(searchPage([]))
    await searchUserPRRepos(octokit as any, 'alice', '2020-01-01', '2024-12-31')
    expect(octokit.search.issuesAndPullRequests).toHaveBeenCalledWith({
      q: 'author:alice type:pr is:merged merged:2020-01-01..2024-12-31',
      per_page: 100,
      page: 1,
    })
  })

  it('paginates while pages are full', async () => {
    const fullPage = (start: number) => searchPage(
      Array.from({ length: 100 }, (_, i) => ({ number: start + i, repo: `org/r${i % 5}` })),
    )
    octokit.search.issuesAndPullRequests
      .mockResolvedValueOnce(fullPage(0))
      .mockResolvedValueOnce(fullPage(100))
      .mockResolvedValueOnce(searchPage([{ number: 999, repo: 'org/r0' }]))  // partial → stop

    const { truncated } = await searchUserPRRepos(octokit as any, 'me', '2024-01-01', '2024-12-31')
    expect(octokit.search.issuesAndPullRequests).toHaveBeenCalledTimes(3)
    expect(truncated).toBe(false)
  })

  it('flags truncated=true when MAX_PAGES (10) reached with full pages', async () => {
    const fullPage = (start: number) => searchPage(
      Array.from({ length: 100 }, (_, i) => ({ number: start + i, repo: `org/r${i}` })),
    )
    // Always return a full page → triggers cap.
    octokit.search.issuesAndPullRequests.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve(fullPage(page * 1000)),
    )

    const { truncated } = await searchUserPRRepos(octokit as any, 'me', '2024-01-01', '2024-12-31')
    expect(octokit.search.issuesAndPullRequests).toHaveBeenCalledTimes(10)
    expect(truncated).toBe(true)
  })

  it('skips items with malformed repository_url', async () => {
    octokit.search.issuesAndPullRequests.mockResolvedValueOnce({
      data: {
        items: [
          { number: 1, repository_url: 'not-a-valid-url' },
          { number: 2, repository_url: 'https://api.github.com/repos/org/good' },
        ],
      },
    })
    const { repos } = await searchUserPRRepos(octokit as any, 'me', '2024-01-01', '2024-12-31')
    expect(repos).toHaveLength(1)
    expect(repos[0].name).toBe('good')
  })
})

describe('fetchRepoPRs', () => {
  let octokit: MockOctokit

  beforeEach(() => {
    octokit = makeOctokit()
  })

  it('fetches each PR by number and returns PullRequest objects', async () => {
    octokit.pulls.get.mockImplementation(({ pull_number }: { pull_number: number }) =>
      Promise.resolve({
        data: {
          title: `PR ${pull_number}`,
          body: `body for ${pull_number}`,
          merged_at: '2024-05-15T12:00:00Z',
        },
      }),
    )

    const prs = await fetchRepoPRs(octokit as any, 'org', 'repo', [1, 2, 3])
    expect(prs).toHaveLength(3)
    expect(prs[0]).toEqual({
      title: 'PR 1',
      body: 'body for 1',
      mergedAt: '2024-05-15',
      filesChanged: [],
    })
    expect(octokit.pulls.get).toHaveBeenCalledTimes(3)
  })

  it('truncates body to 2000 chars', async () => {
    octokit.pulls.get.mockResolvedValueOnce({
      data: {
        title: 'big',
        body: 'x'.repeat(5000),
        merged_at: '2024-01-01T00:00:00Z',
      },
    })
    const prs = await fetchRepoPRs(octokit as any, 'org', 'repo', [1])
    expect(prs[0].body.length).toBe(2000)
  })

  it('skips unmerged PRs (defensive — search filter should exclude these)', async () => {
    octokit.pulls.get
      .mockResolvedValueOnce({ data: { title: 't1', body: '', merged_at: null } })
      .mockResolvedValueOnce({ data: { title: 't2', body: '', merged_at: '2024-01-01T00:00:00Z' } })
    const prs = await fetchRepoPRs(octokit as any, 'org', 'repo', [1, 2])
    expect(prs).toHaveLength(1)
    expect(prs[0].title).toBe('t2')
  })

  it('skips PRs that error during fetch (e.g. 404, deleted)', async () => {
    octokit.pulls.get
      .mockResolvedValueOnce({ data: { title: 't1', body: '', merged_at: '2024-01-01T00:00:00Z' } })
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockResolvedValueOnce({ data: { title: 't3', body: '', merged_at: '2024-01-02T00:00:00Z' } })
    const prs = await fetchRepoPRs(octokit as any, 'org', 'repo', [1, 2, 3])
    expect(prs).toHaveLength(2)
    expect(prs.map(p => p.title)).toEqual(['t1', 't3'])
  })

  it('returns empty array when given empty PR list', async () => {
    const prs = await fetchRepoPRs(octokit as any, 'org', 'repo', [])
    expect(prs).toEqual([])
    expect(octokit.pulls.get).not.toHaveBeenCalled()
  })

  it('handles null body without crashing', async () => {
    octokit.pulls.get.mockResolvedValueOnce({
      data: { title: 't', body: null, merged_at: '2024-01-01T00:00:00Z' },
    })
    const prs = await fetchRepoPRs(octokit as any, 'org', 'repo', [1])
    expect(prs[0].body).toBe('')
  })

  it('reports failed and unmerged counts when requested', async () => {
    octokit.pulls.get
      .mockResolvedValueOnce({ data: { title: 'ok', body: '', merged_at: '2024-01-01T00:00:00Z' } })
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ data: { title: 'open', body: '', merged_at: null } })

    const result = await fetchRepoPRsWithStats(octokit as any, 'org', 'repo', [1, 2, 3])
    expect(result.prs).toHaveLength(1)
    expect(result.requestedCount).toBe(3)
    expect(result.failedCount).toBe(1)
    expect(result.skippedUnmergedCount).toBe(1)
  })
})

describe('buildRepoData', () => {
  let octokit: MockOctokit

  beforeEach(() => {
    octokit = makeOctokit()
  })

  it('combines PR fetch + tech-stack extraction into a RepoData', async () => {
    octokit.pulls.get.mockResolvedValueOnce({
      data: {
        title: 'feat: add gRPC retries',
        body: 'Use Go and gRPC for retry logic.',
        merged_at: '2024-05-15T12:00:00Z',
      },
    })
    const repo = await buildRepoData(octokit as any, 'org', 'svc', [42], '甲公司', '2024.5 - 至今')
    expect(repo.name).toBe('svc')
    expect(repo.org).toBe('org')
    expect(repo.company).toBe('甲公司')
    expect(repo.period).toBe('2024.5 - 至今')
    expect(repo.prs).toHaveLength(1)
    expect(repo.techStack).toContain('Go')
    expect(repo.techStack).toContain('gRPC')
    expect(repo.requestedPrCount).toBe(1)
    expect(repo.failedPrFetchCount).toBe(0)
  })

  it('throws when every requested PR fails to fetch', async () => {
    octokit.pulls.get
      .mockRejectedValueOnce(new Error('404'))
      .mockRejectedValueOnce(new Error('rate limited'))

    await expect(buildRepoData(octokit as any, 'org', 'svc', [1, 2], '甲公司', '2024'))
      .rejects.toThrow(/未能拉取 org\/svc 的有效 PR/)
  })

  it('keeps successful PRs and records partial fetch failures', async () => {
    octokit.pulls.get
      .mockResolvedValueOnce({
        data: {
          title: 'feat: add Redis cache',
          body: 'Use Redis for hot data.',
          merged_at: '2024-01-01T00:00:00Z',
        },
      })
      .mockRejectedValueOnce(new Error('502'))

    const repo = await buildRepoData(octokit as any, 'org', 'svc', [1, 2], '甲公司', '2024')
    expect(repo.prs).toHaveLength(1)
    expect(repo.failedPrFetchCount).toBe(1)
    expect(repo.requestedPrCount).toBe(2)
  })
})

// Type-only check that the public type DiscoveredRepo is usable.
const _typeCheck: DiscoveredRepo = { owner: 'a', name: 'b', prNumbers: [1] }
void _typeCheck
