import { describe, it, expect } from 'vitest'
import { maskKey } from '../../src/config/wizard.js'

describe('maskKey', () => {
  it('returns *** for keys shorter than 16 chars', () => {
    expect(maskKey('')).toBe('***')
    expect(maskKey('short')).toBe('***')
    expect(maskKey('sk-abcd1234')).toBe('***')          // 11 chars
    expect(maskKey('sk-abcd12345abc')).toBe('***')      // 15 chars (boundary)
  })

  it('shows first 4 + last 4 when length >= 16', () => {
    expect(maskKey('sk-abcd1234567890')).toBe('sk-a***7890')   // 17 chars
    expect(maskKey('sk-abcd1234abcd1')).toBe('sk-a***bcd1')   // 16 chars
  })

  it('keeps masking effective for realistic OpenAI key lengths', () => {
    const realisticKey = 'sk-' + 'x'.repeat(48)  // 51 chars
    const masked = maskKey(realisticKey)
    expect(masked.length).toBeLessThan(realisticKey.length / 3)  // most chars hidden
    expect(masked.startsWith('sk-x')).toBe(true)
    expect(masked.endsWith('xxxx')).toBe(true)
  })
})
