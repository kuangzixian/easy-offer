import { describe, it, expect } from 'vitest'
import { extractJSONObject } from '../../src/utils/json.js'

describe('extractJSONObject', () => {
  it('returns the input when it is already pure JSON', () => {
    const json = '{"a": 1}'
    expect(extractJSONObject(json)).toBe(json)
  })

  it('extracts JSON wrapped in markdown code fences', () => {
    const text = '```json\n{"a": 1}\n```'
    expect(extractJSONObject(text)).toBe('{"a": 1}')
  })

  it('extracts JSON when LLM emits a leading prose preamble', () => {
    const text = 'Here is the JSON you asked for:\n{"a": 1}'
    expect(extractJSONObject(text)).toBe('{"a": 1}')
  })

  it('handles nested objects', () => {
    const text = 'output: { "a": { "b": { "c": 1 } } } trailing'
    expect(extractJSONObject(text)).toBe('{ "a": { "b": { "c": 1 } } }')
  })

  it('ignores braces inside string literals', () => {
    const text = '{ "msg": "this { is not } a delimiter" }'
    expect(extractJSONObject(text)).toBe(text)
  })

  it('handles escaped quotes inside strings', () => {
    const text = '{ "msg": "He said \\"hi\\" to me" }'
    expect(extractJSONObject(text)).toBe(text)
  })

  it('does NOT greedy-match across two separate JSON objects + trailing braces', () => {
    // The OLD regex `/\{[\s\S]*\}/` would have grabbed everything from the
    // first `{` to the last `}` — including `{ stray }` — and broken JSON.parse.
    const text = '{"a": 1}\nNote: { stray } in trailing prose'
    expect(extractJSONObject(text)).toBe('{"a": 1}')
  })

  it('throws when no opening brace is found', () => {
    expect(() => extractJSONObject('no json here')).toThrow(/No JSON object/)
  })

  it('throws when braces are unbalanced', () => {
    expect(() => extractJSONObject('{"a": 1')).toThrow(/Unbalanced/)
  })
})
