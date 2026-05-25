import OpenAI from 'openai'
import { loadConfig } from '../config/store.js'

const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1_000

let client: OpenAI | null = null
let cachedModel: string | null = null

function getClient(): { client: OpenAI; model: string } {
  if (!client) {
    const cfg = loadConfig()
    client = new OpenAI({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      timeout: REQUEST_TIMEOUT_MS,
    })
    cachedModel = cfg.model
  }
  return { client, model: cachedModel! }
}

export function resetClient(): void {
  client = null
  cachedModel = null
}

/**
 * Decide whether an error from the OpenAI SDK is worth retrying.
 *
 * Retryable:
 *   - network / no status code (DNS, ECONNRESET, fetch abort, etc.)
 *   - 5xx server errors
 *   - 408 request timeout, 429 rate limit
 *
 * NOT retryable:
 *   - 4xx client errors (auth, bad model name, validation) — retrying just
 *     wastes the user's time and burns rate limit; surface immediately.
 */
export function isRetryableLLMError(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number } } | undefined
  const status = e?.status ?? e?.response?.status
  if (status === undefined) return true       // network / unknown
  if (status >= 500) return true              // server error
  if (status === 408 || status === 429) return true
  return false                                // 4xx client error
}

export async function pingLLM(): Promise<void> {
  const { client, model } = getClient()
  const resp = await client.chat.completions.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  })
  if (!resp.choices[0]) throw new Error('LLM 响应缺少 choices')
}

export interface CallLLMOptions {
  /** Hook to surface retry attempts to a CLI spinner / log. */
  onRetry?: (info: { attempt: number; willRetryIn: number; error: Error }) => void
}

/**
 * Call the configured chat model. Retries up to MAX_RETRIES on retryable
 * errors (5xx, 429, 408, network). 4xx errors throw immediately so the user
 * isn't kept waiting for a configuration mistake.
 */
export async function callLLM(
  system: string,
  user: string,
  maxTokens = 2000,
  options: CallLLMOptions = {},
): Promise<string> {
  const { client, model } = getClient()
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
      lastError = err as Error
      const retryable = isRetryableLLMError(err)
      const moreAttempts = attempt < MAX_RETRIES

      if (!retryable || !moreAttempts) throw lastError

      const willRetryIn = BASE_BACKOFF_MS * attempt
      options.onRetry?.({ attempt, willRetryIn, error: lastError })
      await new Promise(r => setTimeout(r, willRetryIn))
    }
  }

  // Unreachable, but TS needs a return path.
  throw lastError ?? new Error('callLLM: exhausted retries without an error')
}
