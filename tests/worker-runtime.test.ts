import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Miniflare, Response, convertV4MiniflareOptions } from 'miniflare'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const KEY = 'fake-key-for-worker-runtime-tests'
const payload = {
  provider: 'deepseek',
  apiKey: KEY,
  model: 'deepseek-v4-pro',
  messages: [{ role: 'user', content: 'Write a short factual resume.' }],
}
const script = transpileModule(readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText

// Run the production relay in workerd: Node fetch mocks cannot detect unsupported Request options.
// Every outbound request is intercepted locally; these tests never contact a model service.
describe('BYOK relay in the Cloudflare runtime', () => {
  let runtime: Miniflare
  let upstreamStatus = 200
  const calls: { url: string; authorization: string | null; body: unknown }[] = []

  beforeAll(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: '2026-10-05',
      cf: false,
      script,
      outboundService: async request => {
        const call = { url: request.url, authorization: request.headers.get('Authorization'), body: null as unknown }
        calls.push(call)
        if (request.url !== 'https://api.deepseek.com/chat/completions') {
          return new Response('Unexpected outbound destination', { status: 500 })
        }
        call.body = await request.json()
        if (upstreamStatus === 302) {
          return new Response('redirect body must stay private', {
            status: 302,
            headers: { Location: 'https://untrusted.example/collect' },
          })
        }
        if (upstreamStatus === 401) return new Response(`private upstream error ${KEY}`, { status: 401 })
        return Response.json({ choices: [{ message: { content: 'A factual resume.' }, finish_reason: 'stop' }] })
      },
    }))
    await runtime.ready
  }, 15_000)

  beforeEach(() => { calls.length = 0; upstreamStatus = 200 })
  afterAll(async () => { await runtime?.dispose() })

  function send() {
    return runtime.dispatchFetch('https://offer.example/api/chat', {
      method: 'POST',
      headers: { Origin: 'https://offer.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  it('constructs and sends a valid DeepSeek request in workerd', async () => {
    const response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ content: 'A factual resume.' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://api.deepseek.com/chat/completions',
      authorization: `Bearer ${KEY}`,
      body: { model: 'deepseek-v4-pro', messages: payload.messages, max_tokens: 4096, stream: false, thinking: { type: 'disabled' } },
    })
  })

  it('rejects an upstream redirect without following it or forwarding the key elsewhere', async () => {
    upstreamStatus = 302
    const response = await send()
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).not.toContain(KEY)
    expect(body).not.toContain('redirect body must stay private')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
  })

  it('preserves a safe authentication error from the upstream service', async () => {
    upstreamStatus = 401
    const response = await send()
    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).toContain('API Key')
    expect(body).not.toContain(KEY)
    expect(body).not.toContain('private upstream error')
    expect(calls).toHaveLength(1)
  })
})
