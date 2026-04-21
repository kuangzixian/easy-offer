import { callLLM } from '../ai/client.js'

const SYSTEM = `你是一名 OCR 文本清洗助手。输入是中文招聘 JD 截图的 OCR 输出，输出是干净的 JD 纯文本。`

const USER_TEMPLATE = (raw: string) => `## 任务

从 OCR 文本中提取纯净的 JD 正文。**只保留**：岗位名称、职责描述、任职要求、加分项、技能要求。**移除**所有与 JD 正文无关的 UI/设备/平台元素。

## 必须移除的无关内容

**设备状态栏**：时间戳（如 "14:23"）、电量、信号、WiFi 图标文字、运营商名（中国移动 / 中国联通 / 中国电信）

**招聘平台标识 / 导航按钮**：
- 平台名：BOSS 直聘 / 拉勾 / 智联招聘 / 前程无忧 / 猎聘 / 脉脉 / LinkedIn / 51job / 应届生 / boss 等
- 按钮文字：返回 / 分享 / 收藏 / 关注 / 投递 / 立即沟通 / 聊一聊 / 查看更多 / 公司主页 / 举报 等
- 页面标签：页码、"xx 人在看"、"刚刚活跃"、距离标签、城市标签

**职位以外的元信息**：
- HR 姓名 / 职位发布人头衔 / 在线状态
- 薪资气泡 / 薪资悬浮框（JD 正文里明确提到的除外）
- 公司 logo / 水印 / 独立的公司介绍模块（除非在 JD 正文里明确嵌入）

## OCR 噪声修正（同时执行）

- 移除中文字符之间多余的空格（"参 与 并 探索" → "参与并探索"）
- 修正英文 OCR 错误，特别是技术词：AI / CI/CD / IDE / API / SDK / SQL / Node.js / React Native / Koa.js / Egg.js / Cursor / Claude / Agent / Hybrid 等
- 修正常见标点错乱（、 / ， / 。 / : 等混用）
- 修正明显的错别字识别

## 输出格式

- 岗位名称作为首行标题
- 用空行分节（职责 / 要求 / 加分项），保留原有编号
- 不要任何开场白、总结、解释（如"以下是清洗后的文本"）
- 不要改写原意、不要扩写、不要省略 JD 本身的内容
- 不要添加原文不存在的内容

## 待清洗的 OCR 文本

${raw}`

export async function cleanOCRText(raw: string): Promise<string> {
  if (!raw.trim()) return raw
  const cleaned = await callLLM(SYSTEM, USER_TEMPLATE(raw), 3000)
  return cleaned.trim()
}
