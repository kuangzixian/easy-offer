import { describe, it, expect } from 'vitest'
import { maskKey } from '../../src/config/wizard.js'

describe('maskKey', () => {
  it('shows first 3 and last 4 chars when length >= 8', () => {
    expect(maskKey('sk-abcd1234')).toBe('sk-***1234')
  })

  it('shows first 3 and last 4 for an 8-char key', () => {
    expect(maskKey('abcdefgh')).toBe('abc***efgh')
    // Note: when n=8, prefix(3) + suffix(4) = 7 chars revealed; that's the documented threshold.
  })

  it('returns *** only when length < 8', () => {
    expect(maskKey('short')).toBe('***')
    expect(maskKey('')).toBe('***')
    expect(maskKey('abcdefg')).toBe('***')  // n=7, below threshold
  })
})
