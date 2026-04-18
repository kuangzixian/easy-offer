import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Each test gets its own fake home dir; we point HOME at it so configPath() resolves there.
let fakeHome: string
const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'eo-cfg-'))
  process.env.HOME = fakeHome
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
  vi.resetModules()  // re-import store with the new HOME each test
})

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true })
  process.env = { ...ORIGINAL_ENV }
  process.env.HOME = ORIGINAL_HOME!
})

describe('configPath', () => {
  it('returns ~/.easy-offer/config.json', async () => {
    const { configPath } = await import('../../src/config/store.js')
    expect(configPath()).toBe(join(fakeHome, '.easy-offer', 'config.json'))
  })
})

describe('hasConfig', () => {
  it('returns false when file absent', async () => {
    const { hasConfig } = await import('../../src/config/store.js')
    expect(hasConfig()).toBe(false)
  })

  it('returns true when file present', async () => {
    const { saveConfig, hasConfig } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'u', apiKey: 'k', model: 'm' })
    expect(hasConfig()).toBe(true)
  })
})

describe('saveConfig', () => {
  it('writes JSON with 0600 permissions', async () => {
    const { saveConfig, configPath } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'https://api.example.com/v1', apiKey: 'sk-abc', model: 'gpt-4o-mini' })

    const stat = statSync(configPath())
    expect(stat.mode & 0o777).toBe(0o600)

    const written = JSON.parse(readFileSync(configPath(), 'utf8'))
    expect(written).toEqual({ baseURL: 'https://api.example.com/v1', apiKey: 'sk-abc', model: 'gpt-4o-mini' })
  })

  it('creates parent directory if missing', async () => {
    const { saveConfig, configPath } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'u', apiKey: 'k', model: 'm' })
    expect(statSync(configPath()).isFile()).toBe(true)
  })
})

describe('loadConfig', () => {
  it('returns parsed JSON when no env set', async () => {
    const { saveConfig, loadConfig } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'u', apiKey: 'k', model: 'm' })
    expect(loadConfig()).toEqual({ baseURL: 'u', apiKey: 'k', model: 'm' })
  })

  it('overlays OPENAI_BASE_URL', async () => {
    const { saveConfig, loadConfig } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'u', apiKey: 'k', model: 'm' })
    process.env.OPENAI_BASE_URL = 'https://override.example.com'
    expect(loadConfig().baseURL).toBe('https://override.example.com')
  })

  it('overlays OPENAI_API_KEY', async () => {
    const { saveConfig, loadConfig } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'u', apiKey: 'k', model: 'm' })
    process.env.OPENAI_API_KEY = 'sk-env'
    expect(loadConfig().apiKey).toBe('sk-env')
  })

  it('overlays OPENAI_MODEL', async () => {
    const { saveConfig, loadConfig } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'u', apiKey: 'k', model: 'm' })
    process.env.OPENAI_MODEL = 'gpt-4o'
    expect(loadConfig().model).toBe('gpt-4o')
  })

  it('succeeds with env-only when JSON absent', async () => {
    const { loadConfig } = await import('../../src/config/store.js')
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1'
    process.env.OPENAI_API_KEY = 'sk-env'
    process.env.OPENAI_MODEL = 'gpt-4o'
    expect(loadConfig()).toEqual({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-env',
      model: 'gpt-4o',
    })
  })

  it('throws ConfigMissingError when file and env both absent', async () => {
    const { loadConfig, ConfigMissingError } = await import('../../src/config/store.js')
    expect(() => loadConfig()).toThrow(ConfigMissingError)
  })

  it('throws ConfigMissingError when file absent and env partial', async () => {
    const { loadConfig, ConfigMissingError } = await import('../../src/config/store.js')
    process.env.OPENAI_API_KEY = 'sk-env'
    expect(() => loadConfig()).toThrow(ConfigMissingError)
  })

  it('does NOT rewrite JSON file when env overrides are applied', async () => {
    const { saveConfig, loadConfig, configPath } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'orig', apiKey: 'orig', model: 'orig' })
    process.env.OPENAI_API_KEY = 'sk-env'
    loadConfig()
    const stillOnDisk = JSON.parse(readFileSync(configPath(), 'utf8'))
    expect(stillOnDisk.apiKey).toBe('orig')
  })

  it('throws helpful error when JSON file is malformed', async () => {
    const { loadConfig, configPath } = await import('../../src/config/store.js')
    const path = configPath()
    const fs = await import('fs')
    fs.mkdirSync(join(fakeHome, '.easy-offer'), { recursive: true })
    writeFileSync(path, '{ not json')
    expect(() => loadConfig()).toThrow(/config\.json/)
  })
})

describe('loadConfigRaw', () => {
  it('returns JSON without env overrides', async () => {
    const { saveConfig, loadConfigRaw } = await import('../../src/config/store.js')
    saveConfig({ baseURL: 'orig', apiKey: 'orig', model: 'orig' })
    process.env.OPENAI_API_KEY = 'sk-env'
    expect(loadConfigRaw()?.apiKey).toBe('orig')
  })

  it('returns null when file absent', async () => {
    const { loadConfigRaw } = await import('../../src/config/store.js')
    expect(loadConfigRaw()).toBeNull()
  })
})
