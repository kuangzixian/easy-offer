import { describe, it, expect } from 'vitest'
import { pMap } from '../../src/utils/concurrency.js'

describe('pMap', () => {
  it('returns empty array for empty input', async () => {
    const result = await pMap([], 3, async x => x)
    expect(result).toEqual([])
  })

  it('preserves input order in output', async () => {
    const items = [1, 2, 3, 4, 5]
    // Stagger completions: longer delay for earlier items.
    const result = await pMap(items, 2, async x => {
      await new Promise(r => setTimeout(r, (10 - x) * 5))
      return x * 2
    })
    expect(result).toEqual([2, 4, 6, 8, 10])
  })

  it('passes the index as the second argument to fn', async () => {
    const items = ['a', 'b', 'c']
    const result = await pMap(items, 2, async (item, idx) => `${idx}:${item}`)
    expect(result).toEqual(['0:a', '1:b', '2:c'])
  })

  it('respects concurrency limit', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await pMap(items, 3, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(r => setTimeout(r, 10))
      active--
    })

    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBeGreaterThanOrEqual(2)  // not running serially
  })

  it('propagates the first error', async () => {
    const items = [1, 2, 3]
    await expect(
      pMap(items, 2, async x => {
        if (x === 2) throw new Error('boom')
        return x
      }),
    ).rejects.toThrow('boom')
  })

  it('clamps concurrency to items.length', async () => {
    // Should not crash or hang when concurrency > items.length.
    const result = await pMap([1, 2], 100, async x => x + 1)
    expect(result).toEqual([2, 3])
  })
})
