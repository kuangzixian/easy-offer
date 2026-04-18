# OpenAI Client + User Config Design

## Overview

Replace the Anthropic SDK with the OpenAI SDK so the tool can talk to any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Ollama, etc.). The user supplies `baseURL` / `apiKey` / `model` once via an interactive first-launch wizard; the values are persisted to a local JSON file and reused on subsequent runs. An `easy-offer config` subcommand lets the user re-run the wizard, and three environment variables let CI or one-off invocations override individual fields without touching the file.

Claude-specific features (prompt caching, native message format) are intentionally dropped — OpenAI-compatible chat completions are the lowest common denominator and that is acceptable for this tool.

## Components

### 1. Config store — `src/config/store.ts` (new)

Pure persistence layer; no UI.

```ts
export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

export class ConfigMissingError extends Error {}

export function configPath(): string
export function hasConfig(): boolean
export function loadConfig(): LLMConfig    // applies env overrides; throws ConfigMissingError if json missing AND env incomplete
export function saveConfig(cfg: LLMConfig): void  // writes 0600
```

- File location: `~/.easy-offer/config.json`
- File permissions: `0600` on write (owner read/write only)
- Parent directory `~/.easy-offer/` is created if absent (already used by tesseract cache)

**Env override rules** — applied inside `loadConfig`:

| Env var | Overrides |
|---------|-----------|
| `OPENAI_BASE_URL` | `baseURL` |
| `OPENAI_API_KEY` | `apiKey` |
| `OPENAI_MODEL` | `model` |

Merge order: start from JSON (or empty), then for each field apply env if set. If after merging any of the three fields is empty/missing → throw `ConfigMissingError`. JSON is **not** rewritten when env overrides are applied — env is transient.

**Edge case**: if JSON file does not exist but all three env vars are set, `loadConfig` returns the env values without error and without writing JSON. This supports CI/headless usage.

### 2. AI client — `src/ai/client.ts` (rewrite)

Replace Anthropic SDK usage with OpenAI SDK. Single exported function `callLLM` is the only call surface.

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

export async function callLLM(system: string, user: string, maxTokens = 2000): Promise<string> {
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
      // Silent retries by design — only the final error is surfaced to the caller,
      // so transient network blips don't pollute the CLI output. The third failure
      // throws with the original SDK error message intact.
      lastError = err as Error
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastError
}
```

**Removed exports**: `CLAUDE_MODEL`, `getAnthropicClient`, `callClaude`.

**`max_tokens` vs `max_completion_tokens`**: Newer OpenAI models (o1 family and onwards) deprecate `max_tokens` in favor of `max_completion_tokens`. This tool standardizes on `max_tokens` because (a) every OpenAI-compatible third-party endpoint (DeepSeek, OpenRouter, Ollama, local servers) accepts it, while `max_completion_tokens` support is uneven; (b) the default model is `gpt-4o-mini`, which still accepts `max_tokens`. If a user configures an o1-family model and hits a deprecation error, the implementer should surface the original SDK error message verbatim so the user can switch models or set a different config — no automatic field rewriting.

### 3. First-launch ensure — `src/cli.ts` (modify)

Add `await ensureConfig()` near the top of the CLI entry, before subcommand dispatch.

```ts
// in src/cli.ts (or a new src/config/ensure.ts)
export async function ensureConfig(): Promise<void> {
  if (hasConfig()) return
  // try env-only path
  try {
    loadConfig()
    return
  } catch (err) {
    // In non-TTY environments the wizard cannot run; surface the reason so
    // the user knows whether they're missing the file, a specific env var, or both.
    if (!process.stdin.isTTY) {
      console.error(`[config] ${(err as Error).message}`)
    }
  }
  await runConfigWizard()  // see component 4 — will itself fail loudly in non-TTY
}
```

The `easy-offer config` subcommand bypasses this check and runs the wizard unconditionally.

### 4. Config wizard — `src/config/wizard.ts` (new)

Interactive prompt using `inquirer`. Used for both first launch and the `config` subcommand.

```ts
export async function runConfigWizard(): Promise<void> {
  const existing = hasConfig() ? loadConfigRaw() : null  // raw = no env merge
  if (existing?.apiKey) {
    console.log(chalk.dim(`Current API key: ${maskKey(existing.apiKey)}`))
  }
  const answers = await inquirer.prompt([
    { type: 'input',    name: 'baseURL', message: 'OpenAI-compatible API Base URL:',
      default: existing?.baseURL ?? 'https://api.openai.com/v1' },
    { type: 'password', name: 'apiKey',  message: 'API Key:',
      default: existing?.apiKey, mask: '*',
      validate: (v: string) => v.trim().length > 0 || 'API Key is required' },
    { type: 'input',    name: 'model',   message: 'Model name:',
      default: existing?.model ?? 'gpt-4o-mini' },
  ])
  saveConfig(answers)
  console.log(chalk.green(`✓ Config saved to ${configPath()}`))
}
```

When invoked via `easy-offer config` and an existing config is present, the wizard also prints the current `apiKey` masked above the prompts so the user knows what they are about to overwrite.

**Masking rule** for `apiKey` of length `n`:
- `n >= 8` → show first 3 and last 4 characters, with `***` between (e.g. `sk-***1234`)
- `n < 8` → show only `***` (no character leakage), since exposing any prefix/suffix from a short key reveals too large a fraction of the secret

This applies to display only; the stored value is unchanged.

`loadConfigRaw` is a small internal helper that reads the JSON file without env merging — needed so the wizard's defaults reflect the persisted values, not the (possibly transient) env overrides.

### 5. Config subcommand — `src/commands/config.ts` (new)

Thin command that calls `runConfigWizard`. Wired into `src/commands/index.ts` next to existing `fetch` / `build` / `interview`.

## Data Flow

**First run (no config, no env):**
```
easy-offer  →  ensureConfig()  →  hasConfig=false, env incomplete  →  runConfigWizard
            →  user enters baseURL/key/model  →  saveConfig (0600)
            →  proceed with chosen subcommand
```

**Subsequent runs:**
```
easy-offer  →  ensureConfig()  →  hasConfig=true  →  return immediately
            →  first callLLM()  →  loadConfig() reads JSON + applies env overrides
            →  cached OpenAI client used for remainder of process
```

**CI run with env only, no JSON:**
```
OPENAI_BASE_URL=... OPENAI_API_KEY=... OPENAI_MODEL=... easy-offer build
            →  ensureConfig()  →  hasConfig=false, but loadConfig succeeds via env  →  return
            →  callLLM works without ever touching disk
```

**Reconfigure:**
```
easy-offer config  →  runConfigWizard (defaults from existing JSON)  →  saveConfig overwrites
```

## Error Handling

| Situation | Behavior |
|-----------|----------|
| JSON missing + env incomplete on a non-`config` subcommand | `ensureConfig` runs the wizard interactively |
| JSON missing + env incomplete in non-TTY (CI without env) | Wizard prompt fails; surface a clear message: "Config missing. Set OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL or run `easy-offer config` interactively." |
| JSON malformed | Throw with the file path; instruct user to delete the file or run `easy-offer config` |
| OpenAI API call fails (4xx/5xx/network) | Existing 3-attempt exponential backoff in `callLLM`; final error propagates with original message so users see provider-side detail (auth failure, model name typo, etc.) |
| Empty `choices[0].message.content` | Treat as failure, retry under same backoff |

No pre-flight test request during the wizard — saves a quota call and provider-specific error messages on the first real call are clearer than a synthetic test.

## Testing

- `tests/config/store.test.ts`
  - `saveConfig` writes 0600 JSON at expected path
  - `loadConfig` returns parsed JSON when no env set
  - `loadConfig` overlays each env var individually
  - `loadConfig` succeeds with env-only when JSON absent
  - `loadConfig` throws `ConfigMissingError` when both missing
  - `hasConfig` returns false when file absent, true when present
- `tests/ai/client.test.ts`
  - Mock `openai` SDK; verify `chat.completions.create` called with correct `model`, `messages`, `max_tokens`
  - Verify retry-3-then-throw on persistent failure
  - Verify empty-content treated as failure
- `tests/config/wizard.test.ts`
  - `maskKey` returns `sk-***1234`-style output when `key.length >= 8`
  - `maskKey` returns `***` only when `key.length < 8` (no prefix/suffix leakage)

Existing tests under `tests/ai/prompt.test.ts` are unaffected (prompt building is independent of the client).

## Out of Scope

- Multiple named profiles (one config only — YAGNI)
- Streaming responses
- Function/tool calling
- Per-subcommand model overrides
- Pre-flight key validation
- Encrypting the stored API key (file mode 0600 is the bar; OS keychain integration is a separate, larger feature)
