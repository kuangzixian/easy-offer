import { describe, it, expect, vi, beforeEach } from 'vitest'

const { prompt } = vi.hoisted(() => ({ prompt: vi.fn() }))

vi.mock('inquirer', () => ({
  default: { prompt },
}))

describe('askReposToInclude', () => {
  beforeEach(() => {
    prompt.mockReset()
  })

  it('uses stable owner/repo keys so duplicate repo names stay distinct', async () => {
    prompt.mockResolvedValueOnce({ selected: ['org-b/api'] })
    const { askReposToInclude } = await import('../../src/interactive/questions.js')

    const selected = await askReposToInclude([
      { key: 'org-a/api', org: 'org-a', name: 'api', company: 'A', period: '2024', prCount: 2 },
      { key: 'org-b/api', org: 'org-b', name: 'api', company: 'B', period: '2025', prCount: 3 },
    ])

    const question = prompt.mock.calls[0][0][0]
    expect(question.choices.map((c: { value: string }) => c.value)).toEqual(['org-a/api', 'org-b/api'])
    expect(question.choices[0].name).toContain('org-a/api')
    expect(selected).toEqual(['org-b/api'])
  })
})
