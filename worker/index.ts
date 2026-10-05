/** BYOK relay: credentials and documents live only within the current request. */
interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

type Provider = keyof typeof ENDPOINTS
const ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
} as const

const MAX_BODY_BYTES = 256 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const TIMEOUT_MS = 60_000
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS })
}

class TooLarge extends Error {}

async function limitedText(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new TooLarge()
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

interface Payload {
  provider: Provider
  apiKey: string
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  maxTokens: number
}

function parsePayload(value: unknown): Payload | null {
  if (!record(value) || Object.keys(value).some(key => !['provider', 'apiKey', 'model', 'messages', 'maxTokens'].includes(key))) return null
  const { provider, apiKey, model, messages } = value
  if (typeof provider !== 'string' || !Object.hasOwn(ENDPOINTS, provider)) return null
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) return null
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model)) return null
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) return null
  let chars = 0
  for (const message of messages) {
    if (!record(message) || Object.keys(message).some(key => !['role', 'content'].includes(key))) return null
    if (!['system', 'user', 'assistant'].includes(String(message.role))) return null
    if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 60_000) return null
    chars += message.content.length
  }
  if (chars > 80_000 || !messages.some(message => message.role === 'user')) return null
  const maxTokens = value.maxTokens ?? 4096
  if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) return null
  return { provider: provider as Provider, apiKey, model, messages: messages as Payload['messages'], maxTokens }
}

async function relay(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.search) return json({ error: '请求参数请放在正文中。' }, 400)
  if (request.headers.get('Origin') !== url.origin) return json({ error: '请从本站页面发起请求。' }, 403)
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return json({ error: '请求必须使用 JSON。' }, 415)
  const length = request.headers.get('Content-Length')
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return json({ error: '输入内容过长，请缩短后重试。' }, 413)

  let payload: Payload | null
  try {
    payload = parsePayload(JSON.parse(await limitedText(request.body, MAX_BODY_BYTES)))
  } catch (error) {
    return error instanceof TooLarge
      ? json({ error: '输入内容过长，请缩短后重试。' }, 413)
      : json({ error: '请求内容无效。' }, 400)
  }
  if (!payload) return json({ error: '请检查服务商、模型、API Key 和输入内容。' }, 400)
  if (request.signal.aborted) return json({ error: '请求已取消。' }, 499)

  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, TIMEOUT_MS)
  try {
    const upstream = await fetch(ENDPOINTS[payload.provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload.apiKey}` },
      body: JSON.stringify({ model: payload.model, messages: payload.messages, max_tokens: payload.maxTokens, stream: false }),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {})
      const status = upstream.status
      // Do not expose upstream bodies: some providers echo credentials or input in errors.
      if (status === 401 || status === 403) return json({ error: '模型服务拒绝访问，请检查 API Key 和模型权限。' }, 401)
      if (status === 429 || status === 402) return json({ error: '模型服务额度不足或请求过于频繁，请检查余额或稍后再试。' }, 429)
      if (status === 400 || status === 404 || status === 422) return json({ error: '模型服务未接受请求，请检查模型名称及服务商支持情况。' }, 422)
      return json({ error: '模型服务暂时不可用，请稍后再试。' }, 502)
    }
    const data: unknown = JSON.parse(await limitedText(upstream.body, MAX_RESPONSE_BYTES))
    const choices = record(data) && Array.isArray(data.choices) ? data.choices : []
    const message = record(choices[0]) && record(choices[0].message) ? choices[0].message : null
    if (!message || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 100_000) {
      return json({ error: '模型未返回可用文本，请检查模型是否支持文字对话。' }, 502)
    }
    // Never return a leaked key even if an upstream response unexpectedly includes it.
    const content = message.content.split(payload.apiKey).join('[已隐藏凭据]')
    if (record(choices[0]) && choices[0].finish_reason === 'length') {
      return json({ content: `${content}\n\n> 本次输出达到长度上限，内容可能不完整。请减少素材后重新生成。` })
    }
    return json({ content })
  } catch {
    if (timedOut) return json({ error: '生成超时，请稍后重试。模型服务可能已产生费用。' }, 504)
    if (request.signal.aborted) return json({ error: '请求已取消。' }, 499)
    return json({ error: '暂时无法连接模型服务，或返回内容不符合要求。' }, 502)
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abort)
  }
}

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') {
      return request.method === 'GET' && !url.search
        ? json({ ok: true })
        : json({ error: '不支持此请求。' }, 405)
    }
    if (url.pathname === '/api/chat') {
      return request.method === 'POST' ? relay(request) : json({ error: '仅支持 POST 请求。' }, 405)
    }
    if (url.pathname.startsWith('/api/')) return json({ error: '接口不存在。' }, 404)
    return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: '页面不存在。' }, 404)
  },
}
