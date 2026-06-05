import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import type { Cache } from './types.js'

export function getCachePath(dir = '.'): string {
  return resolve(dir, '.github-resume-cache.json')
}

export async function readCache(dir = '.'): Promise<Cache | null> {
  const path = getCachePath(dir)
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  try {
    return JSON.parse(raw) as Cache
  } catch {
    console.warn('⚠ 缓存文件损坏，将重新开始')
    return null
  }
}

export async function writeCache(data: Cache, dir = '.'): Promise<void> {
  const path = getCachePath(dir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}
