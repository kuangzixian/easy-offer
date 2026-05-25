/**
 * Extract the first balanced JSON object substring from a possibly-noisy text.
 * Handles strings + escapes, ignoring `{` and `}` that appear inside string literals.
 *
 * Returns the JSON text (still needs JSON.parse). Throws if no balanced object is found.
 *
 * This is more robust than a greedy `/\{[\s\S]*\}/` regex when the LLM emits
 * surrounding prose or trailing junk like:
 *   "Here is the JSON: { ... } (note the {} are escaped) ..."
 */
export function extractJSONObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in text')

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  throw new Error('Unbalanced JSON object: missing closing brace')
}
