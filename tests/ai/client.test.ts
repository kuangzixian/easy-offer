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

describe('pingLLM', () => {
  it('sends a minimal 1-token probe and resolves on success', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'x' } }] })
    const { pingLLM } = await import('../../src/ai/client.js')
    await expect(pingLLM()).resolves.toBeUndefined()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const call = mockCreate.mock.calls[0][0]
    expect(call.max_tokens).toBe(1)
    expect(call.messages).toEqual([{ role: 'user', content: 'ping' }])
  })

  it('does NOT retry on failure (unlike callLLM)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('400 bad model'))
    const { pingLLM } = await import('../../src/ai/client.js')
    await expect(pingLLM()).rejects.toThrow('400 bad model')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('throws when choices array is empty', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] })
    const { pingLLM } = await import('../../src/ai/client.js')
    await expect(pingLLM()).rejects.toThrow(/choices/)
  })
})

describe('resetClient', () => {
  it('forces re-initialization with fresh config on next call', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'x' } }] })
    const { callLLM, resetClient } = await import('../../src/ai/client.js')
    const openaiModule = await import('openai')
    const openaiCtor = vi.mocked(openaiModule.default)
    openaiCtor.mockClear()

    await callLLM('s', 'u')
    const afterFirst = openaiCtor.mock.calls.length
    expect(afterFirst).toBe(1)

    await callLLM('s', 'u')
    expect(openaiCtor.mock.calls.length).toBe(afterFirst)

    resetClient()
    await callLLM('s', 'u')
    expect(openaiCtor.mock.calls.length).toBe(afterFirst + 1)
  })
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
