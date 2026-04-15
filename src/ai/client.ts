import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-4-6'

let client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required')
    client = new Anthropic({ apiKey })
  }
  return client
}

export async function callClaude(
  system: string,
  user: string,
  maxTokens = 2000,
): Promise<string> {
  const anthropic = getAnthropicClient()
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      })
      const block = response.content[0]
      if (block.type !== 'text') throw new Error('Unexpected response type')
      return block.text
    } catch (err) {
      lastError = err as Error
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastError
}
