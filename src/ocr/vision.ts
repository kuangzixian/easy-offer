import { access } from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { createWorker } from 'tesseract.js'

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'])

export async function extractJDFromImage(
  imagePath: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  try {
    await access(imagePath)
  } catch {
    throw new Error(`文件不存在: ${imagePath}`)
  }

  const ext = path.extname(imagePath).toLowerCase()
  if (!SUPPORTED_EXT.has(ext)) {
    throw new Error('不支持的图片格式，支持: JPEG/PNG/GIF/WEBP/BMP/TIFF')
  }

  const cachePath = path.join(os.homedir(), '.easy-offer', 'tesseract-cache')
  const worker = await createWorker(['chi_sim', 'eng'], 1, {
    cachePath,
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100))
      }
    },
  })

  try {
    const { data } = await worker.recognize(imagePath)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
