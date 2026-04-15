import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

// Mock fs and the AI client before importing the module under test
vi.mock('fs')
vi.mock('../../src/ai/client.js', () => ({
  getAnthropicClient: vi.fn(),
}))

import { extractJDFromImage } from '../../src/ocr/vision.js'
import { getAnthropicClient } from '../../src/ai/client.js'

describe('extractJDFromImage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws when file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    await expect(extractJDFromImage('/tmp/nope.png'))
      .rejects.toThrow('文件不存在')
  })

  it('throws for unsupported extension', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    await expect(extractJDFromImage('/tmp/jd.bmp'))
      .rejects.toThrow('不支持的图片格式')
  })

  it('sends correct media_type for .jpg', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('imgdata') as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '前端工程师 3年经验' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await extractJDFromImage('/tmp/jd.jpg')

    const call = mockCreate.mock.calls[0][0]
    const imageBlock = call.messages[0].content[0]
    expect(imageBlock.source.media_type).toBe('image/jpeg')
  })

  it('sends correct media_type for .png', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('imgdata') as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'some jd text' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await extractJDFromImage('/tmp/jd.png')

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].content[0].source.media_type).toBe('image/png')
  })

  it('encodes file as base64 in request', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const fakeBytes = Buffer.from('hello')
    vi.mocked(fs.readFileSync).mockReturnValue(fakeBytes as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await extractJDFromImage('/tmp/jd.webp')

    const call = mockCreate.mock.calls[0][0]
    expect(call.messages[0].content[0].source.data).toBe(fakeBytes.toString('base64'))
  })

  it('returns extracted text from Claude response', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('x') as any)

    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '我们在找一位 Go 工程师' }],
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    const result = await extractJDFromImage('/tmp/jd.gif')
    expect(result).toBe('我们在找一位 Go 工程师')
  })

  it('throws on API failure', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('x') as any)

    const mockCreate = vi.fn().mockRejectedValue(new Error('API timeout'))
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as any)

    await expect(extractJDFromImage('/tmp/jd.png')).rejects.toThrow('API timeout')
  })
})
