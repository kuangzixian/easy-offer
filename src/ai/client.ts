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
