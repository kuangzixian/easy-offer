# OpenAI Client + User Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Anthropic SDK with the OpenAI SDK and add a persistent local config (`~/.easy-offer/config.json`) so the user supplies `baseURL` / `apiKey` / `model` once, with env-var overrides and an `easy-offer config` subcommand for re-configuration.

**Architecture:** New `src/config/` module (store + wizard + ensure) handles persistence and first-launch prompting. `src/ai/client.ts` is rewritten around the OpenAI SDK and exposes a single `callLLM(system, user, maxTokens)`. Existing callers of `callClaude` are renamed in lockstep with the client rewrite to keep the build green. A new `easy-offer config` subcommand re-runs the wizard.

**Tech Stack:** TypeScript + Node 18+, `openai` npm package, `inquirer` (existing), `commander` (existing), `vitest` (existing).

**Spec:** `docs/superpowers/specs/2026-04-18-openai-config-design.md`

---

## File Structure

**New files:**
- `src/config/store.ts` — Pure persistence: `loadConfig`, `loadConfigRaw`, `saveConfig`, `hasConfig`, `configPath`, `ConfigMissingError`. No UI.
- `src/config/wizard.ts` — Interactive wizard (`runConfigWizard`) plus the exported `maskKey` helper.
- `src/config/ensure.ts` — `ensureConfig()` called from CLI entry; runs wizard if config missing and env incomplete.
- `src/commands/config.ts` — Thin `runConfig` action that calls `runConfigWizard` unconditionally.
- `tests/config/store.test.ts`
- `tests/config/wizard.test.ts` — Only covers `maskKey` (wizard prompts not unit-tested).
- `tests/ai/client.test.ts`

**Modified files:**
- `src/ai/client.ts` — Full rewrite: OpenAI SDK, `callLLM`, drop `callClaude`/`getAnthropicClient`/`CLAUDE_MODEL`.
- `src/commands/build.ts:6,44` — Rename `callClaude` → `callLLM`.
- `src/commands/interview.ts:8,60` — Rename `callClaude` → `callLLM`.
- `src/pdf/reader.ts:3,43` — Rename `callClaude` → `callLLM`.
- `src/commands/index.ts` — Register `config` subcommand.
- `cli.ts` — `await ensureConfig()` before `program.parse()`, except when the invoked subcommand is `config`.
- `tests/pdf/reader.test.ts` — Update mock from `callClaude` → `callLLM`.
- `package.json` — Remove `@anthropic-ai/sdk`, add `openai`.
- `README.md` — Replace `ANTHROPIC_API_KEY` docs with new config section.

**Files NOT touched:**
- `src/ocr/vision.ts` (already local OCR, no LLM dependency)
- `src/ai/prompt.ts` (prompt strings only, model-agnostic)
- `tests/ai/prompt.test.ts`, `tests/github/parser.test.ts`, `tests/ocr/vision.test.ts`

---

## Task 1: Add `openai`, keep `@anthropic-ai/sdk` for now

Adding the new dep first lets later tasks compile without breaking existing callers. Anthropic SDK is removed atomically in Task 5 along with the rewrite.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install openai package**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm install openai
```

Expected: `added N packages` in output, `package.json` `dependencies` now contains `"openai": "^X.Y.Z"`.

- [ ] **Step 2: Verify build still green**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npx tsc --noEmit && npm test
```

Expected: type check clean, all 27 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git add package.json package-lock.json && git commit -m "chore: add openai sdk dependency"
```

---

## Task 2: Config store

**Files:**
- Create: `src/config/store.ts`
- Test: `tests/config/store.test.ts`

The store reads/writes `~/.easy-offer/config.json` with `0600` perms and applies env-var overrides on read. `loadConfigRaw` returns the on-disk JSON without env merging (used by the wizard so its defaults reflect persisted values, not transient env).

- [ ] **Step 1: Write failing tests**

Create `tests/config/store.test.ts`:

```ts
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
    // mode & 0o777 isolates the perm bits
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
    // baseURL and model still missing
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
    // create dir and write garbage
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm test -- tests/config/store.test.ts
```

Expected: FAIL — `Cannot find module '../../src/config/store.js'`

- [ ] **Step 3: Implement `src/config/store.ts`**

Create `src/config/store.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

export class ConfigMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigMissingError'
  }
}

export function configPath(): string {
  return join(homedir(), '.easy-offer', 'config.json')
}

export function hasConfig(): boolean {
  return existsSync(configPath())
}

export function loadConfigRaw(): LLMConfig | null {
  if (!hasConfig()) return null
  const path = configPath()
  let parsed: any
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}. Delete it or run 'easy-offer config'.`)
  }
  return {
    baseURL: parsed.baseURL ?? '',
    apiKey: parsed.apiKey ?? '',
    model: parsed.model ?? '',
  }
}

export function loadConfig(): LLMConfig {
  const fromFile = loadConfigRaw()
  const merged: LLMConfig = {
    baseURL: process.env.OPENAI_BASE_URL ?? fromFile?.baseURL ?? '',
    apiKey:  process.env.OPENAI_API_KEY  ?? fromFile?.apiKey  ?? '',
    model:   process.env.OPENAI_MODEL    ?? fromFile?.model   ?? '',
  }
  const missing = (['baseURL', 'apiKey', 'model'] as const).filter(k => !merged[k])
  if (missing.length > 0) {
    throw new ConfigMissingError(
      `Missing config field(s): ${missing.join(', ')}. ` +
      `Run 'easy-offer config' or set OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL.`,
    )
  }
  return merged
}

export function saveConfig(cfg: LLMConfig): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8')
  chmodSync(path, 0o600)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm test -- tests/config/store.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git add src/config/store.ts tests/config/store.test.ts && git commit -m "feat(config): add JSON-backed LLM config store with env override"
```

---

## Task 3: Config wizard + maskKey

**Files:**
- Create: `src/config/wizard.ts`
- Test: `tests/config/wizard.test.ts`

`maskKey` is the only unit-testable piece (the inquirer prompts themselves are integration territory and out of scope for unit tests).

- [ ] **Step 1: Write failing tests**

Create `tests/config/wizard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { maskKey } from '../../src/config/wizard.js'

describe('maskKey', () => {
  it('shows first 3 and last 4 chars when length >= 8', () => {
    expect(maskKey('sk-abcd1234')).toBe('sk-***1234')
  })

  it('shows first 3 and last 4 for an 8-char key', () => {
    expect(maskKey('abcdefgh')).toBe('abc***efgh')
    // Note: when n=8, prefix(3) + suffix(4) = 7 chars revealed; that's the documented threshold.
  })

  it('returns *** only when length < 8', () => {
    expect(maskKey('short')).toBe('***')
    expect(maskKey('')).toBe('***')
    expect(maskKey('abcdefg')).toBe('***')  // n=7, below threshold
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm test -- tests/config/wizard.test.ts
```

Expected: FAIL — `Cannot find module '../../src/config/wizard.js'`

- [ ] **Step 3: Implement `src/config/wizard.ts`**

Create `src/config/wizard.ts`:

```ts
import inquirer from 'inquirer'
import chalk from 'chalk'
import { configPath, hasConfig, loadConfigRaw, saveConfig, type LLMConfig } from './store.js'

export function maskKey(key: string): string {
  if (key.length < 8) return '***'
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

export async function runConfigWizard(): Promise<void> {
  const existing = hasConfig() ? loadConfigRaw() : null

  if (existing?.apiKey) {
    console.log(chalk.dim(`Current API key: ${maskKey(existing.apiKey)}`))
  }

  const answers = await inquirer.prompt<LLMConfig>([
    {
      type: 'input',
      name: 'baseURL',
      message: 'OpenAI-compatible API Base URL:',
      default: existing?.baseURL ?? 'https://api.openai.com/v1',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      mask: '*',
      validate: (v: string) => v.trim().length > 0 || 'API Key is required',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: existing?.model ?? 'gpt-4o-mini',
    },
  ])

  saveConfig({
    baseURL: answers.baseURL.trim(),
    apiKey: answers.apiKey.trim(),
    model: answers.model.trim(),
  })

  console.log(chalk.green(`✓ Config saved to ${configPath()}`))
}
```

Note: the apiKey prompt intentionally has no `default` — passwords prompts in inquirer don't display defaults clearly, and we already show the masked current key above the prompt. If the user wants to keep the existing key, they re-paste it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm test -- tests/config/wizard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git add src/config/wizard.ts tests/config/wizard.test.ts && git commit -m "feat(config): add interactive wizard with masked key display"
```

---

## Task 4: ensureConfig + `easy-offer config` subcommand + CLI wiring

**Files:**
- Create: `src/config/ensure.ts`
- Create: `src/commands/config.ts`
- Modify: `src/commands/index.ts`
- Modify: `cli.ts`

`ensureConfig` runs at CLI startup for any subcommand except `config` itself (otherwise reconfigure flow couldn't fix a broken config). It tries env-only fallback before invoking the wizard, and logs the failure reason in non-TTY environments.

- [ ] **Step 1: Implement `src/config/ensure.ts`**

Create `src/config/ensure.ts`:

```ts
import { hasConfig, loadConfig } from './store.js'
import { runConfigWizard } from './wizard.js'

export async function ensureConfig(): Promise<void> {
  if (hasConfig()) return
  // Try env-only path before resorting to the wizard.
  try {
    loadConfig()
    return
  } catch (err) {
    if (!process.stdin.isTTY) {
      console.error(`[config] ${(err as Error).message}`)
    }
  }
  await runConfigWizard()
}
```

- [ ] **Step 2: Implement `src/commands/config.ts`**

Create `src/commands/config.ts`:

```ts
import { runConfigWizard } from '../config/wizard.js'

export async function runConfig(): Promise<void> {
  await runConfigWizard()
}
```

- [ ] **Step 3: Register the command**

Modify `src/commands/index.ts`. Add the import and a new `program.command('config')` block after the existing `interview` command:

```ts
// add to existing imports
import { runConfig } from './config.js'
```

And inside `registerCommands`, add:

```ts
  program
    .command('config')
    .description('Configure or reconfigure the LLM (baseURL / apiKey / model)')
    .action(runConfig)
```

- [ ] **Step 4: Wire ensureConfig into `cli.ts`**

Modify `cli.ts`:

```ts
#!/usr/bin/env node
import { program } from 'commander'
import { registerCommands } from './src/commands/index.js'
import { ensureConfig } from './src/config/ensure.js'

program
  .name('easy-offer')
  .description('Generate a tailored resume from your GitHub commit history')
  .version('1.0.0')

registerCommands(program)

async function main() {
  // Skip ensureConfig when the user is running `config` itself,
  // otherwise a broken config could never be fixed.
  const subcommand = process.argv[2]
  if (subcommand !== 'config') {
    await ensureConfig()
  }
  program.parse()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 5: Verify type check**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npx tsc --noEmit
```

Expected: clean (no output).

- [ ] **Step 6: Smoke test the wiring (optional, manual)**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npx tsx cli.ts config --help
```

Expected: prints commander help text for the `config` subcommand. Do not run the full wizard interactively — just confirm it's registered.

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git add src/config/ensure.ts src/commands/config.ts src/commands/index.ts cli.ts && git commit -m "feat(config): wire ensureConfig + 'easy-offer config' subcommand"
```

---

## Task 5: Rewrite AI client around OpenAI SDK + rename callers + remove Anthropic SDK

This is the breaking change. Done atomically so the build never sits broken between commits.

**Files:**
- Modify (rewrite): `src/ai/client.ts`
- Modify: `src/commands/build.ts:6,44`
- Modify: `src/commands/interview.ts:8,60`
- Modify: `src/pdf/reader.ts:3,43`
- Modify: `tests/pdf/reader.test.ts:6,9,40,69,75`
- Create: `tests/ai/client.test.ts`
- Modify: `package.json` (remove `@anthropic-ai/sdk`)

- [ ] **Step 1: Write failing tests for the new client**

Create `tests/ai/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}))

let fakeHome: string
const ORIGINAL_HOME = process.env.HOME

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'eo-cli-'))
  process.env.HOME = fakeHome
  process.env.OPENAI_BASE_URL = 'https://api.example.com/v1'
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OPENAI_MODEL = 'gpt-test'
  vi.resetModules()
  mockCreate.mockReset()
})

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true })
  process.env.HOME = ORIGINAL_HOME!
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
})

describe('callLLM', () => {
  it('calls chat.completions.create with model, messages, max_tokens', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'hello' } }],
    })
    const { callLLM } = await import('../../src/ai/client.js')

    const result = await callLLM('sys', 'usr', 1500)
    expect(result).toBe('hello')
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-test',
      max_tokens: 1500,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    })
  })

  it('uses default maxTokens=2000 when omitted', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'x' } }],
    })
    const { callLLM } = await import('../../src/ai/client.js')
    await callLLM('s', 'u')
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(2000)
  })

  it('retries up to 3 times on failure then throws final error', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockRejectedValueOnce(new Error('fail-3'))
    const { callLLM } = await import('../../src/ai/client.js')
    await expect(callLLM('s', 'u')).rejects.toThrow('fail-3')
    expect(mockCreate).toHaveBeenCalledTimes(3)
  }, 10000)

  it('treats empty content as failure (retries)', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'recovered' } }] })
    const { callLLM } = await import('../../src/ai/client.js')
    const result = await callLLM('s', 'u')
    expect(result).toBe('recovered')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  }, 5000)

  it('succeeds on retry after a transient failure', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] })
    const { callLLM } = await import('../../src/ai/client.js')
    const result = await callLLM('s', 'u')
    expect(result).toBe('ok')
  }, 5000)
})
```

- [ ] **Step 2: Run new client tests to verify they fail**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm test -- tests/ai/client.test.ts
```

Expected: FAIL — likely `callClaude is not a function` or import errors, since the file still exports the Anthropic version.

- [ ] **Step 3: Rewrite `src/ai/client.ts`**

Replace the full content of `src/ai/client.ts`:

```ts
import OpenAI from 'openai'
import { loadConfig } from '../config/store.js'

let client: OpenAI | null = null
let cachedModel: string | null = null

function getClient(): { client: OpenAI; model: string } {
  if (!client) {
    const cfg = loadConfig()
    client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey })
    cachedModel = cfg.model
  }
  return { client, model: cachedModel! }
}

export async function callLLM(
  system: string,
  user: string,
  maxTokens = 2000,
): Promise<string> {
  const { client, model } = getClient()
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })
      const text = resp.choices[0]?.message?.content
      if (!text) throw new Error('Empty response from LLM')
      return text
    } catch (err) {
      // Silent retries by design — only the final error reaches the caller.
      lastError = err as Error
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastError
}
```

- [ ] **Step 4: Update callers**

Modify `src/commands/build.ts` line 6 and 44:

```ts
// line 6
import { callLLM } from '../ai/client.js'
// line 44
      const result = await callLLM(system, user)
```

Modify `src/commands/interview.ts` line 8 and 60:

```ts
// line 8
import { callLLM } from '../ai/client.js'
// line 60
    const result = await callLLM('你是一位资深技术面试辅导专家。', prompt, 4000)
```

Modify `src/pdf/reader.ts` line 3 and 43:

```ts
// line 3
import { callLLM } from '../ai/client.js'
// line 43
  const raw = await callLLM(system, user, 2000)
```

- [ ] **Step 5: Update `tests/pdf/reader.test.ts`**

Replace `callClaude` with `callLLM` everywhere. Specifically:

```ts
// line 5-6
vi.mock('../../src/ai/client.js', () => ({
  callLLM: vi.fn(),
}))

// line 9
import { callLLM } from '../../src/ai/client.js'

// line 40
  vi.mocked(callLLM).mockResolvedValue(mockClaudeResponse)

// line 69
    vi.mocked(callLLM).mockResolvedValue('```json\n' + mockClaudeResponse + '\n```')

// line 75
    vi.mocked(callLLM).mockResolvedValue('抱歉，无法解析该简历。')
```

The `mockClaudeResponse` constant name can stay (it's just a variable name; renaming it is purely cosmetic and out of scope).

- [ ] **Step 6: Remove `@anthropic-ai/sdk` dependency**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npm uninstall @anthropic-ai/sdk
```

Expected: `removed N packages`, `package.json` no longer lists `@anthropic-ai/sdk`.

- [ ] **Step 7: Type check + run all tests**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npx tsc --noEmit && npm test
```

Expected:
- Type check clean (no output)
- All tests pass: existing 27 tests + 12 new (store) + 3 new (wizard) + 5 new (client) ≈ 47 tests

If `tests/ai/client.test.ts` retry test takes too long, raise vitest test timeout (already done via the per-test `, 10000` argument) — the 1 + 2 second backoffs add ~3s.

- [ ] **Step 8: Commit**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git add src/ai/client.ts src/commands/build.ts src/commands/interview.ts src/pdf/reader.ts tests/ai/client.test.ts tests/pdf/reader.test.ts package.json package-lock.json && git commit -m "feat: replace Anthropic SDK with OpenAI-compatible client"
```

---

## Task 6: README update

**Files:**
- Modify: `README.md`

Replace `ANTHROPIC_API_KEY` mentions with the new config flow. Both English and Chinese sections need updating.

- [ ] **Step 1: Find existing references**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && grep -n "ANTHROPIC_API_KEY\|anthropic" README.md
```

Expected: 2 matches (one in EN prerequisites, one in 中文 前置条件).

- [ ] **Step 2: Update prerequisites section**

In `README.md`, under English `### Prerequisites`, replace the line:

```
- `ANTHROPIC_API_KEY` environment variable (required for resume generation)
```

with:

```
- LLM access via any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Ollama, etc.). On first run, the CLI prompts for `baseURL`, `apiKey`, and `model`, and saves them to `~/.easy-offer/config.json` (mode 0600). Re-run with `easy-offer config` to change. Or set `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` env vars to override individual fields.
```

In the 中文 `### 前置条件` section, replace:

```
- `ANTHROPIC_API_KEY` 环境变量（简历生成需要）
```

with:

```
- 任何 OpenAI 兼容接口（OpenAI、DeepSeek、OpenRouter、本地 Ollama 等）。首次运行时 CLI 会引导你输入 `baseURL` / `apiKey` / `model`，存到 `~/.easy-offer/config.json`（权限 0600）。后续修改运行 `easy-offer config`。也可设置环境变量 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` 覆盖单个字段。
```

- [ ] **Step 3: Update Subcommands section if it lists commands**

Check `README.md` for a Subcommands section that lists `fetch` / `build` / `interview`. If found, add:

```
easy-offer config    # Configure / reconfigure LLM (baseURL / apiKey / model)
```

- [ ] **Step 4: Verify**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && grep -n "ANTHROPIC_API_KEY\|anthropic" README.md
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git add README.md && git commit -m "docs: replace ANTHROPIC_API_KEY with new openai-compatible config flow"
```

---

## Final Verification

After all tasks complete, run:

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && npx tsc --noEmit && npm test
```

Expected: type-check clean, all tests pass.

```bash
cd /Users/apple/Documents/project/nodeJS/easy-offer && git log --oneline -10
```

Expected to see the 6 new commits in order: `chore: add openai sdk`, `feat(config): add JSON-backed`, `feat(config): add interactive wizard`, `feat(config): wire ensureConfig`, `feat: replace Anthropic SDK`, `docs: replace ANTHROPIC_API_KEY`.

Manual smoke test (optional):

```bash
# Backup any real config first
mv ~/.easy-offer/config.json ~/.easy-offer/config.json.bak 2>/dev/null
cd /Users/apple/Documents/project/nodeJS/easy-offer && npx tsx cli.ts config
# Walk through the wizard with throwaway values, then verify file:
cat ~/.easy-offer/config.json && stat -f '%Mp%Lp' ~/.easy-offer/config.json
# Restore real config
mv ~/.easy-offer/config.json.bak ~/.easy-offer/config.json 2>/dev/null
```

Expected: file content matches inputs, perms are `0600`.
