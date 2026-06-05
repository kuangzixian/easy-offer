import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCachePath, readCache, writeCache } from '../src/cache.js'
import type { Cache } from '../src/types.js'

const sampleCache: Cache = {
  fetchedAt: '2026-01-01T00:00:00.000Z',
  username: 'alice',
  role: 'go',
  jd: null,
  targetPosition: null,
  profile: { name: 'Alice', phone: '', email: '' },
  existingExperience: [],
  education: '',
  repos: [],
}

describe('writeCache', () => {
  it('creates the output directory before writing cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eo-cache-'))
    const outputDir = join(root, 'nested', 'out')

    try {
      await writeCache(sampleCache, outputDir)
      expect(existsSync(getCachePath(outputDir))).toBe(true)
      await expect(readCache(outputDir)).resolves.toEqual(sampleCache)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
