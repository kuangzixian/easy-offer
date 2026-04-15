import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fsPromises from 'fs/promises'

// Mock fs/promises and the AI client before importing the module under test
vi.mock('fs/promises')
vi.mock('../../src/ai/client.js', () => ({
  getAnthropicClient: vi.fn(),
  CLAUDE_MODEL: 'claude-sonnet-4-6',
}))

import { extractJDFromImage } from '../../src/ocr/vision.js'
import { getAnthropicClient } from '../../src/ai/client.js'

describe('extractJDFromImage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws when file does not exist', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    await expect(extractJDFromImage('/tmp/nope.png'))
      .rejects.toThrow('文件不存在')
  })

  it('throws for unsupported extension', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    await expect(extractJDFromImage('/tmp/jd.bmp'))
      .rejects.toThrow('不支持的图片格式')
  })

  it.each([
    ['.jpg',  'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png',  'image/png'],
    ['.gif',  'image/gif'],
    ['.webp', 'image/webp'],
  ])('sends correct media_type for %s', async (ext, expectedType) => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('imgdata') as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'jd text' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await extractJDFromImage(`/tmp/jd${ext}`)

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].content[0].source.media_type).toBe(expectedType)
  })

  it('encodes file as base64 in request', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    const fakeBytes = Buffer.from('hello')
    vi.mocked(fsPromises.readFile).mockResolvedValue(fakeBytes as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await extractJDFromImage('/tmp/jd.webp')

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].content[0].source.data).toBe(fakeBytes.toString('base64'))
  })

  it('returns extracted text from Claude response', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('x') as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '我们在找一位 Go 工程师' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    const result = await extractJDFromImage('/tmp/jd.gif')
    expect(result).toBe('我们在找一位 Go 工程师')
  })

  it('throws on API failure', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('x') as any)

    const mockCreate = vi.fn().mockRejectedValue(new Error('API timeout'))
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await expect(extractJDFromImage('/tmp/jd.png')).rejects.toThrow('API timeout')
  })
})
