import { access, readFile } from 'fs/promises'
import * as path from 'path'
import { getAnthropicClient, CLAUDE_MODEL } from '../ai/client.js'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

const EXT_TO_MEDIA_TYPE: Record<string, ImageMediaType> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
}

export async function extractJDFromImage(imagePath: string): Promise<string> {
  try {
    await access(imagePath)
  } catch {
    throw new Error(`文件不存在: ${imagePath}`)
  }

  const ext = path.extname(imagePath).toLowerCase()
  const mediaType = EXT_TO_MEDIA_TYPE[ext]
  if (!mediaType) {
    throw new Error('不支持的图片格式，支持: JPEG、PNG、GIF、WEBP')
  }

  const imageData = await readFile(imagePath)
  const base64 = imageData.toString('base64')

  const anthropic = getAnthropicClient()
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: '请将图片中的招聘 JD（职位描述）文字完整提取出来，只返回纯文本，不要添加任何解释或格式。',
        },
      ],
    }],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Claude Vision 返回了非文本响应')
  return block.text
}
