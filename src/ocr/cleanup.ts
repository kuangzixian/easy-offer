import { callLLM } from '../ai/client.js'

const SYSTEM = `你是一名 OCR 文本清洗助手。输入是中文招聘 JD 截图的 OCR 输出，输出是修正后的纯文本。`

const USER_TEMPLATE = (raw: string) => `中文 OCR 结果常见噪声：
- 中文字符之间被错误插入空格（如"参 与 并 探索"应为"参与并探索"）
- 大小写英文字母混淆：Al→AI、Hl→HI、CIMCD→CI/CD、HIIDE→IDE、O 与 0 混用 等
- 标点错乱：、 / , / ， / . / 。 混用
- 偶尔识别错的字（如"链路"被认成"链 各"）

你的任务：
1. 移除中文字符之间多余的空格
2. 修正明显的英文 OCR 错误（技术词优先：AI、CI/CD、IDE、API、SDK、SQL、Node.js、React Native、Koa.js、Egg.js、Cursor、Claude、Agent、Hybrid 等）
3. 严格保留原有的编号、序号、缩进、换行结构
4. 不要改写原意、不要总结、不要省略、不要扩写
5. 不要添加原文中不存在的内容
6. 不要任何开场白或解释（如"以下是清洗后的文本"），直接返回修正后的纯文本

待清洗的 OCR 文本：
${raw}`

export async function cleanOCRText(raw: string): Promise<string> {
  if (!raw.trim()) return raw
  const cleaned = await callLLM(SYSTEM, USER_TEMPLATE(raw), 3000)
  return cleaned.trim()
}
