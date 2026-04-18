import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fsPromises from 'fs/promises'

vi.mock('fs/promises')

const mockRecognize = vi.fn()
const mockTerminate = vi.fn()
const mockCreateWorker = vi.fn()

vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => mockCreateWorker(...args),
}))

import { extractJDFromImage } from '../../src/ocr/vision.js'

describe('extractJDFromImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateWorker.mockResolvedValue({
      recognize: mockRecognize,
      terminate: mockTerminate,
    })
  })

  it('throws when file does not exist', async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'))
    await expect(extractJDFromImage('/tmp/nope.png'))
      .rejects.toThrow('文件不存在')
  })

  it('throws for unsupported extension', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    await expect(extractJDFromImage('/tmp/jd.heic'))
      .rejects.toThrow('不支持的图片格式')
  })

  it.each(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'])(
    'accepts %s extension',
    async ext => {
      vi.mocked(fsPromises.access).mockResolvedValue(undefined)
      mockRecognize.mockResolvedValue({ data: { text: 'hello' } })

      await expect(extractJDFromImage(`/tmp/jd${ext}`)).resolves.toBe('hello')
    },
  )

  it('initializes worker with chi_sim + eng languages', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    mockRecognize.mockResolvedValue({ data: { text: 'jd text' } })

    await extractJDFromImage('/tmp/jd.png')

    expect(mockCreateWorker).toHaveBeenCalledWith(
      ['chi_sim', 'eng'],
      1,
      expect.objectContaining({ cachePath: expect.stringContaining('.easy-offer') }),
    )
  })

  it('returns trimmed text from recognize result', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    mockRecognize.mockResolvedValue({ data: { text: '  我们在找一位 Go 工程师  \n' } })

    const result = await extractJDFromImage('/tmp/jd.gif')
    expect(result).toBe('我们在找一位 Go 工程师')
  })

  it('terminates worker even when recognize fails', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    mockRecognize.mockRejectedValue(new Error('OCR failed'))

    await expect(extractJDFromImage('/tmp/jd.png')).rejects.toThrow('OCR failed')
    expect(mockTerminate).toHaveBeenCalled()
  })

  it('reports progress via callback during recognition', async () => {
    vi.mocked(fsPromises.access).mockResolvedValue(undefined)
    mockRecognize.mockResolvedValue({ data: { text: 'x' } })

    const progress: number[] = []
    let capturedLogger: ((m: { status: string; progress: number }) => void) | undefined
    mockCreateWorker.mockImplementationOnce((_langs, _oem, opts: any) => {
      capturedLogger = opts?.logger
      return Promise.resolve({ recognize: mockRecognize, terminate: mockTerminate })
    })

    await extractJDFromImage('/tmp/jd.png', pct => progress.push(pct))

    capturedLogger?.({ status: 'recognizing text', progress: 0.5 })
    capturedLogger?.({ status: 'loading tesseract core', progress: 0.1 })
    capturedLogger?.({ status: 'recognizing text', progress: 1 })

    expect(progress).toEqual([50, 100])
  })
})
