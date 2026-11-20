import { catalogs, type MessageKey } from './messages'
export type { MessageKey }

export const LOCALES = ['zh', 'en', 'es', 'ko', 'ja'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_META: Record<Locale, { htmlLang: string; nativeName: string; path: string }> = {
  zh: { htmlLang: 'zh-CN', nativeName: '中文', path: '/' },
  en: { htmlLang: 'en', nativeName: 'English', path: '/en/' },
  es: { htmlLang: 'es', nativeName: 'Español', path: '/es/' },
  ko: { htmlLang: 'ko', nativeName: '한국어', path: '/ko/' },
  ja: { htmlLang: 'ja', nativeName: '日本語', path: '/ja/' },
}

export const LOCALE_STORAGE_KEY = 'easy-offer:locale'

let currentLocale: Locale = 'zh'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function localeFromPath(pathname: string): Locale | null {
  const match = pathname.match(/^\/(en|es|ko|ja|zh)(?=\/|$)/)
  return match && isLocale(match[1]) ? match[1] : null
}

export function pathForLocale(locale: Locale): string {
  return LOCALE_META[locale].path
}

export function mapBrowserLang(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase().replace('_', '-')
  if (!lower) return null
  const primary = lower.split('-')[0]
  if (primary === 'zh') return 'zh'
  if (primary === 'en') return 'en'
  if (primary === 'es') return 'es'
  if (primary === 'ko') return 'ko'
  if (primary === 'ja') return 'ja'
  return null
}

export function detectLocale(input?: { pathname?: string; stored?: string | null; languages?: readonly string[] }): Locale {
  const pathname = input?.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  const fromPath = localeFromPath(pathname)
  if (fromPath) return fromPath

  const stored = input?.stored ?? (typeof window !== 'undefined' ? readStoredLocale() : null)
  if (isLocale(stored)) return stored

  const languages = input?.languages ?? (typeof navigator !== 'undefined'
    ? (navigator.languages?.length ? navigator.languages : [navigator.language])
    : [])
  for (const tag of languages) {
    const mapped = mapBrowserLang(tag ?? '')
    if (mapped) return mapped
  }
  return 'zh'
}

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage may be unavailable; language still works for this session.
  }
}

export function t(key: MessageKey, vars?: Record<string, string | number>, locale: Locale = currentLocale): string {
  const template = catalogs[locale][key] ?? catalogs.zh[key]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
  ))
}

export function applyDocumentMeta(locale: Locale = currentLocale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = LOCALE_META[locale].htmlLang
  document.title = t('pageTitle', {}, locale)
  const description = t('pageDescription', {}, locale)
  let meta = document.querySelector('meta[name="description"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'description')
    document.head.append(meta)
  }
  meta.setAttribute('content', description)
}

export const WORKER_ERROR_KEYS = {
  REQUEST_QUERY_FORBIDDEN: 'errQueryForbidden',
  ORIGIN_FORBIDDEN: 'errOriginForbidden',
  JSON_REQUIRED: 'errJsonRequired',
  PAYLOAD_TOO_LARGE: 'errPayloadTooLarge',
  INVALID_JSON: 'errInvalidJson',
  INVALID_PAYLOAD: 'errInvalidPayload',
  REQUEST_CANCELLED: 'errRequestCancelled',
  UPSTREAM_REDIRECT: 'errUpstreamRedirect',
  UPSTREAM_UNAUTHORIZED: 'errUpstreamUnauthorized',
  UPSTREAM_RATE_LIMITED: 'errUpstreamRateLimited',
  UPSTREAM_BAD_REQUEST: 'errUpstreamBadRequest',
  UPSTREAM_UNAVAILABLE: 'errUpstreamUnavailable',
  UPSTREAM_EMPTY: 'errUpstreamEmpty',
  OUTPUT_TRUNCATED: 'errOutputTruncated',
  GENERATION_TIMEOUT: 'errGenerationTimeout',
  UPSTREAM_TOO_LARGE: 'errUpstreamTooLarge',
  UPSTREAM_INVALID_RESPONSE: 'errUpstreamInvalidResponse',
  UPSTREAM_INTERRUPTED: 'errUpstreamInterrupted',
  UPSTREAM_CONNECTION_FAILED: 'errUpstreamConnectionFailed',
  METHOD_NOT_ALLOWED: 'errMethodNotAllowed',
  METHOD_POST_ONLY: 'errMethodPostOnly',
  NOT_FOUND: 'errNotFound',
} as const satisfies Record<string, MessageKey>

export function localizeWorkerError(code: unknown, fallback: string, locale: Locale = currentLocale): string {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(WORKER_ERROR_KEYS, code)) {
    return t(WORKER_ERROR_KEYS[code as keyof typeof WORKER_ERROR_KEYS], {}, locale)
  }
  return fallback
}
