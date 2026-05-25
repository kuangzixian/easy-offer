import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { expandHome } from '../../src/utils/path.js'

describe('expandHome', () => {
  const home = homedir()

  it('expands "~" alone', () => {
    expect(expandHome('~')).toBe(home)
  })

  it('expands "~/foo" → home/foo', () => {
    expect(expandHome('~/foo')).toBe(`${home}/foo`)
  })

  it('expands "~/Desktop/jd.png"', () => {
    expect(expandHome('~/Desktop/jd.png')).toBe(`${home}/Desktop/jd.png`)
  })

  it('does not expand "~user/foo" (only literal "~/" or "~\\")', () => {
    expect(expandHome('~root/foo')).toBe('~root/foo')
  })

  it('does not change absolute paths', () => {
    expect(expandHome('/tmp/foo')).toBe('/tmp/foo')
    expect(expandHome('/home/user/file')).toBe('/home/user/file')
  })

  it('does not change relative paths', () => {
    expect(expandHome('./foo')).toBe('./foo')
    expect(expandHome('foo/bar')).toBe('foo/bar')
  })

  it('returns empty string unchanged', () => {
    expect(expandHome('')).toBe('')
  })
})
