// Post-build: emit static per-locale HTML so lang/title/meta/OG are correct before JS runs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { catalogs } from '../web/messages'

const BASE = 'https://easy-offer.kznb.workers.dev'
const meta = { en: ['en', 'en_US'], es: ['es', 'es_ES'], ko: ['ko', 'ko_KR'], ja: ['ja', 'ja_JP'] } as const
const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const src = readFileSync('dist-web/index.html', 'utf8')
for (const [code, [lang, ogLocale]] of Object.entries(meta)) {
  const c = catalogs[code as keyof typeof catalogs]
  const title = attr(c.pageTitle), desc = attr(c.pageDescription), url = `${BASE}/${code}/`
  const out = src
    .replace(/<html lang="[^"]*">/, `<html lang="${lang}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${desc}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${desc}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`)
    .replace(/(<meta property="og:locale" content=")[^"]*/, `$1${ogLocale}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`)
  mkdirSync(`dist-web/${code}`, { recursive: true })
  writeFileSync(`dist-web/${code}/index.html`, out)
}
console.log('locale html written')
