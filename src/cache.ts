import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'
import type { Cache } from './types.js'

export function getCachePath(dir = '.'): string {
  return resolve(dir, '.github-resume-cache.json')
}

export async function readCache(dir = '.'): Promise<Cache | null> {
  const path = getCachePath(dir)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as Cache
}

export async function writeCache(data: Cache, dir = '.'): Promise<void> {
  const path = getCachePath(dir)
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}
