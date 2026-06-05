import { describe, it, expect } from 'vitest'
import { shouldEnsureConfig } from '../../src/config/gate.js'

describe('shouldEnsureConfig', () => {
  it('does not require LLM config for help and version requests', () => {
    expect(shouldEnsureConfig(['--help'])).toBe(false)
    expect(shouldEnsureConfig(['build', '--help'])).toBe(false)
    expect(shouldEnsureConfig(['-h'])).toBe(false)
    expect(shouldEnsureConfig(['--version'])).toBe(false)
    expect(shouldEnsureConfig(['-V'])).toBe(false)
  })

  it('does not require LLM config for config or help subcommands', () => {
    expect(shouldEnsureConfig(['config'])).toBe(false)
    expect(shouldEnsureConfig(['help', 'build'])).toBe(false)
  })

  it('requires LLM config for commands that can call the model', () => {
    expect(shouldEnsureConfig([])).toBe(true)
    expect(shouldEnsureConfig(['fetch'])).toBe(true)
    expect(shouldEnsureConfig(['build'])).toBe(true)
    expect(shouldEnsureConfig(['interview'])).toBe(true)
  })
})
