import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index.js'

const KEY = 'fake-key-for-unit-tests'
const valid = { provider: 'deepseek', apiKey: KEY, model: 'deepseek-chat', messages: [{ role: 'user', content: 'Write a factual resume.' }] }
function request(body: unknown = valid, extra: RequestInit = {}, path = '/api/chat'): Request {
  return new Request(`https://offer.example${path}`, { method: 'POST', headers: { Origin: 'https://offer.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra })
}
function answer(content = 'result'): Response {
  return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('BYOK Worker', () => {
  it('forwards only the supplied key to a fixed provider endpoint', async () => {
    const upstream = vi.fn().mockResolvedValue(answer())
    vi.stubGlobal('fetch', upstream)
    const response = await worker.fetch(request())
    expect(await response.json()).toEqual({ content: 'result' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.redirect).toBe('error')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toEqual({ model: 'deepseek-chat', messages: valid.messages, max_tokens: 4096, stream: false })
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ ...valid, provider: 'https://evil.example/' }, 400],
    [{ ...valid, provider: '__proto__' }, 400],
    [{ ...valid, endpoint: 'http://127.0.0.1:8080' }, 400],
    [{ ...valid, apiKey: '' }, 400],
    [{ ...valid, apiKey: 'fake-key\r\nInjected: value' }, 400],
    [{ ...valid, messages: [{ role: 'tool', content: 'x' }] }, 400],
    [{ ...valid, messages: [{ role: 'system', content: 'x' }] }, 400],
    [{ ...valid, messages: [{ role: 'user', content: 'x'.repeat(60_001) }] }, 400],
    [{ ...valid, maxTokens: 10_000 }, 400],
    [{ ...valid, model: '../../etc/key?foo=bar' }, 400],
  ])('rejects malformed configuration without fetching upstream', async (body, status) => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    expect((await worker.fetch(request(body))).status).toBe(status)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects cross-origin, absent origin, non-JSON, query keys and oversize bodies', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const origin of ['https://evil.example', 'null', 'https://offer.example.evil.test', '']) {
      const response = await worker.fetch(request(valid, { headers: { Origin: origin, 'Content-Type': 'application/json' } }))
      expect(response.status).toBe(403)
    }
    expect((await worker.fetch(request(valid, { headers: { Origin: 'https://offer.example', 'Content-Type': 'text/plain' } }))).status).toBe(415)
    expect((await worker.fetch(request(valid, {}, `?key=${KEY}`))).status).toBe(404)
    expect((await worker.fetch(request(valid, {}, `/api/chat?key=${KEY}`))).status).toBe(400)
    expect((await worker.fetch(request({ ...valid, messages: [{ role: 'user', content: '长'.repeat(100_000) }] }))).status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('does not reuse a key across concurrent requests', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { seen.push(init.headers.Authorization); return answer() }))
    await Promise.all([
      worker.fetch(request({ ...valid, apiKey: 'first-fake-test-key' })),
      worker.fetch(request({ ...valid, apiKey: 'second-fake-test-key' })),
    ])
    expect(seen.sort()).toEqual(['Bearer first-fake-test-key', 'Bearer second-fake-test-key'])
  })

  it.each([401, 403, 400, 404, 402, 429, 500, 302])('never returns provider error bodies or retries (upstream %s)', async status => {
    const upstream = vi.fn().mockResolvedValue(new Response(`upstream accidentally echoed ${KEY}`, { status }))
    vi.stubGlobal('fetch', upstream)
    const response = await worker.fetch(request())
    expect(response.ok).toBe(false)
    expect(await response.text()).not.toContain(KEY)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('sanitizes unexpected secret echo and flags truncated answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: `hello ${KEY}` }, finish_reason: 'length' }] })))
    const text = await (await worker.fetch(request())).text()
    expect(text).not.toContain(KEY)
    expect(text).toContain('长度上限')
  })

  it('rejects oversized and malformed provider output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1))))
    expect((await worker.fetch(request())).status).toBe(502)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [] })))
    expect((await worker.fetch(request())).status).toBe(502)
  })

  it('propagates cancellation and stops a timed-out upstream without retry', async () => {
    const upstream = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', upstream)
    const controller = new AbortController()
    const pending = worker.fetch(request(valid, { signal: controller.signal }))
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledOnce())
    controller.abort()
    expect((await pending).status).toBe(499)
    vi.useFakeTimers()
    const timeoutPending = worker.fetch(request())
    await vi.advanceTimersByTimeAsync(60_001)
    expect((await timeoutPending).status).toBe(504)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('serves a secret-free health endpoint and refuses unsupported API methods', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const response = await worker.fetch(new Request('https://offer.example/api/health'))
    expect(await response.json()).toEqual({ ok: true })
    expect((await worker.fetch(new Request('https://offer.example/api/chat'))).status).toBe(405)
    expect((await worker.fetch(new Request('https://offer.example/api/unknown'))).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })
})
