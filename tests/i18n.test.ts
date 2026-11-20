import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalogs } from '../web/messages.js'
import {
  LOCALES,
  detectLocale,
  localeFromPath,
  pathForLocale,
  mapBrowserLang,
  setLocale,
  t,
} from '../web/i18n.js'
import { buildWebInterviewMessages, buildWebResumeMessages, chat } from '../web/client.js'

afterEach(() => {
  setLocale('zh')
  vi.unstubAllGlobals()
})

describe('message catalogs', () => {
  const keys = Object.keys(catalogs.zh)

  it('keeps the same keys in every language and fills every string', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(catalogs[locale])).toEqual(keys)
      for (const key of keys) {
        if (key === 'titleBeforeHighlight') continue
        expect(catalogs[locale][key as keyof typeof catalogs.zh].length).toBeGreaterThan(0)
      }
    }
  })
})

describe('locale detection', () => {
  it('reads language prefixes from the path', () => {
    expect(localeFromPath('/')).toBeNull()
    expect(localeFromPath('/writing')).toBeNull()
    expect(localeFromPath('/en')).toBe('en')
    expect(localeFromPath('/en/')).toBe('en')
    expect(localeFromPath('/ja/other')).toBe('ja')
    expect(localeFromPath('/zh')).toBe('zh')
    expect(pathForLocale('zh')).toBe('/')
    expect(pathForLocale('ko')).toBe('/ko/')
  })

  it('maps browser languages and prefers the path over storage', () => {
    expect(mapBrowserLang('zh-CN')).toBe('zh')
    expect(mapBrowserLang('en-US')).toBe('en')
    expect(mapBrowserLang('es-MX')).toBe('es')
    expect(mapBrowserLang('ko-KR')).toBe('ko')
    expect(mapBrowserLang('ja-JP')).toBe('ja')
    expect(mapBrowserLang('fr-FR')).toBeNull()
    expect(detectLocale({ pathname: '/es/', stored: 'ja', languages: ['en'] })).toBe('es')
    expect(detectLocale({ pathname: '/', stored: 'ko', languages: ['en'] })).toBe('ko')
    expect(detectLocale({ pathname: '/', stored: null, languages: ['ja-JP', 'en'] })).toBe('ja')
    expect(detectLocale({ pathname: '/', stored: null, languages: ['fr-FR'] })).toBe('zh')
  })

  it('interpolates placeholders', () => {
    expect(t('projectCount', { count: 3 }, 'en')).toBe('3 projects')
    expect(t('warnPrFetchFailed', { failed: 1, reason: 'timeout' }, 'zh')).toContain('1 条 PR 详情读取失败')
  })
})

describe('localized prompts and worker errors', () => {
  it('writes resume and interview prompts in the selected language', () => {
    setLocale('en')
    const messages = buildWebResumeMessages({
      profile: { name: 'Test', email: '', phone: '' },
      role: 'node',
      jd: 'Need Node.js',
      experience: '',
      education: '',
      repos: [],
    })
    expect(messages[0].content).toContain('careful resume editor writing in English')
    expect(messages[0].content).toContain('Node.js Engineer')
    expect(messages[0].content).toContain('Accuracy first')
    expect(messages[0].content).not.toContain('中文简历编辑')
    const interview = buildWebInterviewMessages('resume', 'jd')
    expect(interview[0].content).toContain('English-language technical interview')
    expect(interview[0].content).not.toContain('中文技术面试')
    setLocale('zh')
    expect(buildWebResumeMessages({
      profile: { name: 'Test', email: '', phone: '' },
      role: 'node',
      jd: '',
      experience: '',
      education: '',
      repos: [],
    })[0].content).toContain('中文简历编辑')
  })

  it('localizes relay error codes for the current language', async () => {
    setLocale('en')
    const fetcher = vi.fn().mockResolvedValue(Response.json(
      { error: '模型服务拒绝访问，请检查 API Key 和模型权限。', code: 'UPSTREAM_UNAUTHORIZED' },
      { status: 401 },
    ))
    vi.stubGlobal('fetch', fetcher)
    await expect(chat(
      { provider: 'deepseek', apiKey: 'fake-model-key', model: 'deepseek-chat' },
      [{ role: 'user', content: 'test' }],
    )).rejects.toThrow('The model service denied access')
  })
})
