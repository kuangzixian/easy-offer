import puppeteer from 'puppeteer'
import { marked } from 'marked'
import { writeFile } from 'fs/promises'

const CSS = `
  body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 13px; line-height: 1.6; margin: 40px; color: #222; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 15px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 20px; }
  h3 { font-size: 14px; margin-bottom: 4px; }
  ul { margin: 4px 0; padding-left: 20px; }
  li { margin-bottom: 3px; }
  strong { color: #111; }
  hr { border: none; border-top: 1px solid #eee; margin: 12px 0; }
  p { margin: 4px 0; }
`

export async function markdownToPDF(markdownContent: string, outputPath: string): Promise<void> {
  const html = await marked(markdownContent)
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' })
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    })
  } finally {
    await browser.close()
  }
}
