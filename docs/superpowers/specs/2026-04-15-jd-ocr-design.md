# JD OCR Input Design

## Goal

Replace the current EOF-based JD text paste with a three-option menu: screenshot OCR via Claude Vision, manual text paste, or skip. Users who have a JD as a screenshot no longer need to manually transcribe it.

## Architecture

OCR logic lives in a new `src/ocr/vision.ts` module. The interactive question in `src/interactive/questions.ts` is updated to show a three-option list and delegate to the OCR module when the user selects the image path option. No other files need changes.

**Tech Stack:** `@anthropic-ai/sdk` (already a dependency), Node.js `fs` for file reading, base64 encoding, `ora` for spinner, `chalk` for output.

**Claude dependency note:** OCR calls consume Claude API tokens (`claude-sonnet-4-6`) even before resume generation begins. This is documented in README.

---

## Components

### `src/ocr/vision.ts` (new)

Single exported function:

```typescript
import { getAnthropicClient } from '../ai/client.js'

export async function extractJDFromImage(imagePath: string): Promise<string>
```

**Always import `getAnthropicClient()` from `../ai/client.js`** — never construct `new Anthropic()` directly. This reuses the singleton and its existing missing-key error guard.

**File validation:**
- Check file exists (throw if not: `"文件不存在: <path>"`)
- Check extension against supported set; throw if not: `"不支持的图片格式，支持: JPEG、PNG、GIF、WEBP"`

**Media type mapping** (required exact strings for Claude Vision API):

| Extension | `media_type` |
|-----------|-------------|
| `.jpg`, `.jpeg` | `"image/jpeg"` |
| `.png` | `"image/png"` |
| `.gif` | `"image/gif"` |
| `.webp` | `"image/webp"` |

**API call:**

```typescript
const anthropic = getAnthropicClient()
const imageData = fs.readFileSync(imagePath)
const base64 = imageData.toString('base64')

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,   // JD text can be 1000–2000 tokens; 4096 avoids truncation
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
```

Returns the extracted text string. Throws on API failure with the original error message.

---

### `src/interactive/questions.ts` — `askTargetPosition()` update

New flow after the user enters a non-empty position name:

```
是否提供 JD？
❯ 1. 提供截图路径（Claude Vision OCR）
  2. 手动粘贴文字
  3. 跳过
```

Import: `import { extractJDFromImage } from '../ocr/vision.js'` (`.js` extension required — project uses `moduleResolution: NodeNext`).

**Option 1 — Screenshot OCR:**
1. Prompt for file path
2. Start `ora` spinner: `'正在识别图片...'`
3. Call `extractJDFromImage(path)`
4. On success: `spinner.succeed('识别完成')`, print first 3 non-empty lines as preview
5. Ask: `'识别结果是否正确？'` (confirm, default true)
   - Yes → return `{ position, jd: extractedText }`
   - No → print `'请改用手动粘贴'`, fall through to **Option 2** prompt (readline/END)
6. On error: `spinner.fail(err.message)`, print `'将改为手动粘贴'`, fall through to **Option 2** prompt

**Option 2 — Manual paste (existing logic, unchanged):**
- readline reads lines until `END`
- Guard: if lines is empty after END, return `{ position, jd: null }` (not `""`)

**Option 3 — Skip:**
- return `{ position, jd: null }`

Return type unchanged: `Promise<{ position: string; jd: string | null }>`

---

## Error Handling

| Error | Behavior |
|-------|----------|
| File not found | `spinner.fail()`, fall through to manual paste prompt |
| Unsupported format | `spinner.fail()` with supported formats listed, fall through to manual paste prompt |
| API failure | `spinner.fail(err.message)`, fall through to manual paste prompt |
| User rejects OCR result | Print message, fall through to manual paste prompt |
| Manual paste is empty | Return `jd: null` (not `""`) |

---

## README Update

In the "How it works" section, step 0:

> JD 输入现支持直接提供截图（JPEG/PNG/GIF/WEBP），由 Claude Vision 自动识别文字；也可手动粘贴文字。OCR 识别功能依赖 Claude API，会消耗少量 token。

In the prerequisites section, note that OCR is Claude-dependent.

---

## Testing

- Unit test `extractJDFromImage`: mock `fs.readFileSync` and `getAnthropicClient()`, assert correct `media_type` per extension and correct `base64` encoding in the request
- Unit test unsupported extension throws with correct message
- Unit test file-not-found throws with correct message
- No UI integration test for `askTargetPosition` (interactive prompts are not unit-tested in this project)
