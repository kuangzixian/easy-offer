import './style.css'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ROLES } from '../src/roles'
import type { RepoData, RoleKey, UserProfile } from '../src/types'
import { PROVIDERS, chat, importGitHub, buildWebResumeMessages, buildWebInterviewMessages, parseCacheJson } from './client'
import type { Provider } from './client'
import {
  LOCALES, LOCALE_META, applyDocumentMeta, detectLocale, getLocale, localeFromPath,
  persistLocale, pathForLocale, setLocale, t, type Locale, type MessageKey,
} from './i18n'

const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  github: '<path d="M9 19c-4.3 1.3-4.3-2.1-6-2.6M15 22v-3.9c0-1.1.1-1.6-.5-2.2 3.3-.4 6.8-1.6 6.8-7.2 0-1.6-.6-2.9-1.5-4 .2-.4.7-1.9-.2-3.9 0 0-1.2-.4-4.1 1.5a14 14 0 0 0-7.5 0C5.1.4 3.9.8 3.9.8c-.8 2-.3 3.5-.2 3.9a5.8 5.8 0 0 0-1.5 4c0 5.6 3.5 6.8 6.8 7.2-.4.4-.8 1.2-.8 2.3V22"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  book: '<path d="M12 5v16M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
}
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const field = (id: string) => el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)
const value = (id: string) => field(id).value.trim()
const today = new Date().toISOString().slice(0, 10)
const from = `${new Date().getFullYear() - 2}-01-01`
const STORAGE_KEY = 'easy-offer:web-draft:v1'
const savedFields = ['name', 'role', 'email', 'phone', 'jd', 'experience', 'education', 'github', 'from', 'to', 'provider', 'model'] as const
const transientFields = [...savedFields, 'api-key', 'github-token', 'resume-editor', 'interview-editor'] as const
type DraftStatus = '' | 'saved' | 'failed' | 'restored' | 'stopped' | 'cleared' | 'clear-failed'
let repos: RepoData[] = []
let selected = new Set<number>()
let resume = ''
let interview = ''
let step = 0
let busy: 'github' | 'cache' | 'resume' | 'interview' | null = null
let controller: AbortController | null = null
let draftTimer: ReturnType<typeof setTimeout> | undefined
let activeArtifact: 'resume' | 'interview' = 'resume'
let resumeView: 'preview' | 'edit' = 'preview'
let materialsStale = false
let interviewStaleFlag = false
let draftStatus: DraftStatus = ''
let booted = false

function providerLabel(id: Provider): string {
  return id === 'volcengine' ? t('providerVolcengine') : (PROVIDERS.find(p => p.id === id)?.label ?? id)
}

function roleLabel(key: string): string {
  return t(('role_' + key) as MessageKey)
}

function currentPath(): string {
  const path = location.pathname || '/'
  if (path === '/') return '/'
  return localeFromPath(path) && !path.endsWith('/') ? `${path}/` : path
}

function syncLocalePath(locale: Locale, mode: 'replace' | 'push'): void {
  const desired = pathForLocale(locale)
  if (currentPath() === desired) return
  const url = desired + location.search + location.hash
  if (mode === 'push') history.pushState({ locale }, '', url)
  else history.replaceState({ locale }, '', url)
}

function initLocale(): void {
  const locale = detectLocale()
  setLocale(locale)
  persistLocale(locale)
  syncLocalePath(locale, 'replace')
  applyDocumentMeta(locale)
}

function captureFields(): Record<string, string> {
  if (!document.getElementById('name')) return {}
  return Object.fromEntries(transientFields.filter(id => document.getElementById(id)).map(id => [id, field(id).value]))
}

function restoreFields(values: Record<string, string>): void {
  for (const [id, text] of Object.entries(values)) {
    if (document.getElementById(id)) field(id).value = text
  }
}

function applyDraftStatus(): void {
  const node = document.getElementById('draft-state')
  if (!node) return
  const messages: Record<DraftStatus, string> = {
    '': '',
    saved: t('draftSaved'),
    failed: t('draftSaveFailed'),
    restored: t('draftRestored'),
    stopped: t('draftStopped'),
    cleared: t('draftCleared'),
    'clear-failed': t('draftClearFailed'),
  }
  node.textContent = messages[draftStatus]
}

function applyResumeView(): void {
  const editing = resumeView === 'edit'
  if (!document.getElementById('resume-editor')) return
  el('resume-editor').hidden = !editing
  el('resume-preview').hidden = editing
  document.querySelectorAll('[data-view]').forEach(tab => tab.classList.toggle('active', tab.getAttribute('data-view') === resumeView))
}

function applyStaleNotices(): void {
  if (document.getElementById('stale-notice')) el('stale-notice').hidden = !materialsStale
  if (document.getElementById('export-stale')) el('export-stale').hidden = !materialsStale
  if (document.getElementById('interview-stale')) el('interview-stale').hidden = !interviewStaleFlag
}

function renderApp(fields?: Record<string, string>): void {
  const saved = fields ?? captureFields()
  const saveDraftChecked = document.getElementById('save-draft') ? el<HTMLInputElement>('save-draft').checked : false
  const keyVisible = document.getElementById('api-key') ? el<HTMLInputElement>('api-key').type === 'text' : false
  el('app').innerHTML = shellHtml()
  restoreFields(saved)
  if (document.getElementById('save-draft') && (saveDraftChecked || draftStatus === 'restored' || draftStatus === 'saved')) {
    el<HTMLInputElement>('save-draft').checked = saveDraftChecked || draftStatus === 'restored' || draftStatus === 'saved'
  }
  if (keyVisible) {
    el<HTMLInputElement>('api-key').type = 'text'
    el('toggle-key').setAttribute('aria-label', t('hideApiKey'))
    el('toggle-key').setAttribute('aria-pressed', 'true')
  }
  bindEvents()
  renderRepos()
  if (resume) {
    field('resume-editor').value = resume
    el('resume-output').hidden = false
    el('resume-empty').hidden = true
    renderMarkdown(resume, el('resume-preview'))
  }
  if (interview) {
    field('interview-editor').value = interview
    el('interview-output').hidden = false
    renderMarkdown(interview, el('interview-preview'))
  }
  applyResumeView()
  applyStaleNotices()
  applyDraftStatus()
  goto(step, false)
  if (busy) setBusy(busy)
  applyDocumentMeta()
}

function languageSwitcher(): string {
  return `<label class="lang-switch"><span class="visually-hidden">${esc(t('langLabel'))}</span><select id="locale-select" aria-label="${esc(t('langLabel'))}">${LOCALES.map(code => `<option value="${code}"${code === getLocale() ? ' selected' : ''}>${esc(LOCALE_META[code].nativeName)}</option>`).join('')}</select></label>`
}

function shellHtml(): string {
  const steps = [t('step0'), t('step1'), t('step2'), t('step3')]
  return `
<header class="site-header"><a class="brand" href="${esc(pathForLocale(getLocale()))}" aria-label="${esc(t('brandHomeAria'))}"><span class="brand-mark">e<span>↗</span></span><span>easy<span class="brand-light">offer</span><span class="brand-dot">.</span></span></a><div class="header-right"><span class="header-note">${esc(t('headerNote'))}</span>${languageSwitcher()}<a class="github-link" href="https://github.com/kuangzixian/easy-offer" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('githubAria'))}">${icon('github')}<span>${esc(t('githubLink'))}</span></a></div></header>
<main>
<section class="intro"><div><p class="eyebrow"><span></span> ${esc(t('eyebrow'))}</p><h1>${esc(t('titleLead'))}<br>${esc(t('titleBeforeHighlight'))}<span class="title-highlight">${esc(t('titleHighlight'))}<svg viewBox="0 0 280 15" aria-hidden="true"><path d="M3 11Q130-2 275 8"/></svg></span>${esc(t('titleAfterHighlight'))}</h1><p class="intro-copy">${esc(t('introCopy1'))}<br>${esc(t('introCopy2'))}</p><button id="demo" class="text-button">${esc(t('trySample'))} ${icon('arrow')}</button></div><div class="intro-visual" aria-hidden="true"><div class="paper-tag">${esc(t('paperTag'))}</div><div class="mini-resume"><div class="mini-heading">${esc(t('miniHeading'))}<span>${esc(t('miniSub'))}</span></div><div class="mini-line wide"></div><div class="mini-line"></div><div class="mini-section">${esc(t('miniLine1a'))} <span>→</span> ${esc(t('miniLine1b'))}</div><div class="mini-line wide"></div><div class="mini-line short"></div><div class="mini-section">${esc(t('miniLine2a'))} <span>→</span> ${esc(t('miniLine2b'))}</div><div class="mini-line"></div><div class="mini-line wide"></div></div><span class="visual-sticker">${esc(t('sticker1'))}<br>${esc(t('sticker2'))} ${icon('check')}</span></div></section>
<div class="workbench-top"><div><span class="section-kicker">${esc(t('workbenchKicker'))}</span><span class="workbench-sub">${esc(t('workbenchSub'))}</span></div><span class="cost-tag">${esc(t('costTag'))}</span></div>
<nav class="steps" aria-label="${esc(t('stepsNavAria'))}">${steps.map((s, i) => `<button class="step${i === step ? ' active' : ''}${i < step ? ' completed' : ''}" data-step="${i}" aria-current="${i === step ? 'step' : 'false'}"><span class="step-number">0${i + 1}</span><span>${esc(s)}</span>${i < 3 ? '<span class="step-arrow">↗</span>' : ''}</button>`).join('')}</nav>
<div id="status" class="status" role="status" aria-live="polite" hidden></div>
<div class="workspace"><div class="main-panel">
<section id="step-0" class="step-panel" aria-labelledby="heading-0"><div class="panel-heading"><div><p class="section-kicker">${esc(t('step0Kicker'))}</p><h2 id="heading-0">${esc(t('step0Title'))}</h2><p>${esc(t('step0Lead'))}</p></div><span class="panel-icon">${icon('file')}</span></div>
<div class="field-grid"><label>${esc(t('nameLabel'))} <span class="required">*</span><input id="name" placeholder="${esc(t('namePlaceholder'))}" maxlength="80" autocomplete="name"></label><label>${esc(t('roleLabel'))}<select id="role">${ROLES.map(r => `<option value="${r.key}"${r.key === 'node' ? ' selected' : ''}>${esc(roleLabel(r.key))}</option>`).join('')}</select></label><label>${esc(t('emailLabel'))} <span class="optional">${esc(t('optional'))}</span><input id="email" type="email" placeholder="${esc(t('emailPlaceholder'))}" autocomplete="email" maxlength="160"></label><label>${esc(t('phoneLabel'))} <span class="optional">${esc(t('optional'))}</span><input id="phone" type="tel" placeholder="${esc(t('phonePlaceholder'))}" autocomplete="tel" maxlength="40"></label></div>
<div class="field-divider"></div>
<label>${esc(t('jdLabel'))} <span class="optional">${esc(t('optional'))}</span><span class="field-hint">${esc(t('jdHint'))}</span><textarea id="jd" rows="5" maxlength="10000" placeholder="${esc(t('jdPlaceholder'))}"></textarea></label>
<label class="spaced-label">${esc(t('experienceLabel'))} <span class="optional">${esc(t('experienceOptional'))}</span><span class="field-hint">${esc(t('experienceHint'))}</span><textarea id="experience" rows="7" maxlength="12000" placeholder="${esc(t('experiencePlaceholder'))}"></textarea></label>
<label class="spaced-label">${esc(t('educationLabel'))} <span class="optional">${esc(t('optional'))}</span><textarea id="education" rows="2" maxlength="3000" placeholder="${esc(t('educationPlaceholder'))}"></textarea></label>
<div class="panel-footer"><span>${esc(t('step0FooterNote'))}</span><button class="button primary" data-next="1">${esc(t('nextSelectProjects'))} ${icon('arrow')}</button></div></section>
<section id="step-1" class="step-panel" aria-labelledby="heading-1" hidden><div class="panel-heading"><div><p class="section-kicker">${esc(t('step1Kicker'))}</p><h2 id="heading-1">${esc(t('step1Title'))}</h2><p>${esc(t('step1Lead'))}</p></div><span class="panel-icon">${icon('github')}</span></div>
<div class="soft-note">${icon('lock')}<p>${esc(t('step1Note'))}</p></div>
<div class="field-grid"><label class="full-width">${esc(t('githubUserLabel'))}<input id="github" placeholder="${esc(t('githubUserPlaceholder'))}" autocapitalize="off" spellcheck="false" maxlength="80"></label><label>${esc(t('dateFromLabel'))}<input id="from" type="date" value="${from}"></label><label>${esc(t('dateToLabel'))}<input id="to" type="date" value="${today}"></label></div>
<details class="advanced"><summary>${esc(t('tokenSummary'))}</summary><label>${esc(t('tokenLabel'))}<input id="github-token" type="password" placeholder="${esc(t('tokenPlaceholder'))}" autocomplete="off" spellcheck="false" autocapitalize="off"></label><p class="field-hint">${esc(t('tokenHint'))}</p></details>
<div class="import-actions"><button id="import-github" class="button primary">${icon('github')} ${esc(t('importGithub'))}</button><label class="button secondary upload-label">${icon('upload')} ${esc(t('importCache'))}<input id="cache-file" type="file" accept=".json,application/json" class="visually-hidden"></label><button id="cancel-github" class="text-button cancel-button" hidden>${esc(t('cancelImport'))}</button></div>
<p class="field-hint import-note">${esc(t('cacheHint'))}</p>
<div id="repo-list"></div>
<div class="panel-footer"><button class="text-button" data-next="0">${esc(t('backToMaterials'))}</button><button class="button primary" data-next="2">${esc(t('nextGenerate'))} ${icon('arrow')}</button></div></section>
<section id="step-2" class="step-panel" aria-labelledby="heading-2" hidden><div class="panel-heading"><div><p class="section-kicker">${esc(t('step2Kicker'))}</p><h2 id="heading-2">${esc(t('step2Title'))}</h2><p>${esc(t('step2Lead'))}</p></div><span class="panel-icon">${icon('spark')}</span></div>
<div class="model-config"><div class="field-grid"><label>${esc(t('providerLabel'))}<select id="provider">${PROVIDERS.map(p => `<option value="${p.id}">${esc(providerLabel(p.id))}</option>`).join('')}</select></label><label>${esc(t('modelLabel'))}<input id="model" value="${esc(PROVIDERS[0]?.defaultModel || '')}" placeholder="${esc(t('modelPlaceholder'))}" maxlength="120" spellcheck="false"></label><label class="full-width">${esc(t('apiKeyLabel'))}<div class="password-wrap"><input id="api-key" type="password" placeholder="${esc(t('apiKeyPlaceholder'))}" autocomplete="off" spellcheck="false" autocapitalize="off"><button id="toggle-key" type="button" aria-label="${esc(t('showApiKey'))}" aria-pressed="false">${icon('eye')}</button></div></label></div><p class="privacy-copy">${icon('lock')}<span>${esc(t('privacyCopy'))}</span></p><p class="field-hint sampling-note">${esc(t('samplingNote'))}</p><div class="generation-actions"><button id="generate" class="button primary">${icon('spark')} ${esc(t('generateResume'))}</button><button id="cancel-generation" class="text-button cancel-button" hidden>${esc(t('cancelGenerate'))}</button><span id="generation-state" class="field-hint">${esc(t('generatingHint'))}</span></div></div>
<p id="stale-notice" class="stale-notice" hidden>${esc(t('staleResume'))}</p><div id="resume-output" class="output-area" hidden><div class="output-heading"><h3>${esc(t('resumeDraftTitle'))}</h3><div class="view-tabs" role="group" aria-label="${esc(t('viewModeAria'))}"><button class="active" data-view="preview">${esc(t('viewPreview'))}</button><button data-view="edit">${esc(t('viewEdit'))}</button></div></div><p class="field-hint">${esc(t('resumeCheckHint'))}</p><textarea id="resume-editor" class="markdown-editor" aria-label="${esc(t('resumeEditorAria'))}" spellcheck="false" hidden></textarea><article id="resume-preview" class="document-preview"></article></div>
<div id="resume-empty" class="empty-state"><span>${icon('file')}</span><h3>${esc(t('emptyTitle'))}</h3><p>${esc(t('emptyBody1'))}<br>${esc(t('emptyBody2'))}</p></div>
<div class="panel-footer"><button class="text-button" data-next="1">${esc(t('backToProjects'))}</button><button class="button primary" data-next="3">${esc(t('nextExport'))} ${icon('arrow')}</button></div></section>
<section id="step-3" class="step-panel" aria-labelledby="heading-3" hidden><div class="panel-heading"><div><p class="section-kicker">${esc(t('step3Kicker'))}</p><h2 id="heading-3">${esc(t('step3Title'))}</h2><p>${esc(t('step3Lead'))}</p></div><span class="panel-icon">${icon('download')}</span></div>
<p id="export-stale" class="stale-notice" hidden>${esc(t('exportStale'))}</p><div class="export-cards"><div class="export-card"><span class="export-icon">${icon('file')}</span><h3>${esc(t('mdCardTitle'))}</h3><p>${esc(t('mdCardBody'))}</p><button id="download-resume" class="button secondary">${icon('download')} ${esc(t('downloadMarkdown'))}</button></div><div class="export-card"><span class="export-icon">${icon('book')}</span><h3>${esc(t('pdfCardTitle'))}</h3><p>${esc(t('pdfCardBody'))}</p><button id="print-resume" class="button secondary">${icon('download')} ${esc(t('printPdf'))}</button></div></div>
<div class="interview-callout"><div><p class="section-kicker">${esc(t('interviewKicker'))}</p><h3>${esc(t('interviewTitle'))}</h3><p>${esc(t('interviewLead'))}</p></div><div class="interview-actions"><button id="generate-interview" class="button primary">${icon('spark')} ${esc(t('generateInterview'))}</button><button id="cancel-interview" class="text-button cancel-button" hidden>${esc(t('cancelInterview'))}</button></div></div>
<div id="interview-output" hidden><p id="interview-stale" class="stale-notice" hidden>${esc(t('interviewStale'))}</p><div class="output-heading"><h3>${esc(t('interviewListTitle'))}</h3><button id="download-interview" class="button secondary small">${icon('download')} ${esc(t('downloadMarkdown'))}</button></div><label class="spaced-label">${esc(t('editInterview'))}<textarea id="interview-editor" class="markdown-editor compact" spellcheck="false"></textarea></label><article id="interview-preview" class="document-preview"></article></div>
<div class="panel-footer"><button class="text-button" data-next="2">${esc(t('backToResume'))}</button><span>${esc(t('footerEncourage'))}</span></div></section>
</div>
<aside class="workspace-aside"><div class="aside-card"><span class="aside-label">${esc(t('asideLabel'))}</span><h3 id="summary-name">${esc(t('blankName'))}</h3><p id="summary-role">${esc(roleLabel('node'))}</p><div class="summary-stats"><div><strong id="summary-repos">0</strong><span>${esc(t('selectedProjects'))}</span></div><div><strong id="summary-prs">0</strong><span>${esc(t('mergedRecords'))}</span></div></div><div class="aside-divider"></div><ul class="guidelines"><li>${icon('check')}${esc(t('guideline1'))}</li><li>${icon('check')}${esc(t('guideline2'))}</li><li>${icon('check')}${esc(t('guideline3'))}</li></ul></div><div class="draft-card">${icon('lock')}<h3>${esc(t('draftTitle'))}</h3><p>${esc(t('draftBody'))}</p><label class="checkbox-label"><input id="save-draft" type="checkbox"><span>${esc(t('saveDraft'))}</span></label><p class="field-hint">${esc(t('saveDraftHint'))}</p><button id="clear-draft" class="text-button">${esc(t('clearDraft'))}</button><span id="draft-state" class="draft-state" aria-live="polite"></span></div><div class="aside-quote">“${esc(t('quote1'))}<br>${esc(t('quote2'))}”<span>${esc(t('quoteSub'))}</span></div></aside></div>
</main><footer class="site-footer"><span>easyoffer. <span class="footer-muted">${esc(t('footerTagline'))}</span></span><a href="https://github.com/kuangzixian/easy-offer" target="_blank" rel="noopener noreferrer">${esc(t('footerOpenSource'))}</a></footer>`
}

function status(message: string, kind: 'success' | 'error' | 'info' = 'info') {
  el('status').textContent = message
  el('status').className = `status ${kind}`
  el('status').hidden = !message
}

function goto(next: number, scroll = true) {
  step = next
  document.querySelectorAll<HTMLElement>('.step-panel').forEach((p, i) => { p.hidden = i !== step })
  document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b, i) => {
    b.classList.toggle('active', i === step)
    b.classList.toggle('completed', i < step)
    b.setAttribute('aria-current', i === step ? 'step' : 'false')
  })
  if (scroll) document.querySelector('.steps')!.scrollIntoView({ behavior: 'smooth', block: 'start' })
  updateSummary()
}

function updateSummary() {
  el('summary-name').textContent = value('name') || t('blankName')
  el('summary-role').textContent = roleLabel(value('role') || 'node')
  el('summary-repos').textContent = String(selected.size)
  el('summary-prs').textContent = String(repos.reduce((n, r, i) => n + (selected.has(i) ? r.prs.length : 0), 0))
  el<HTMLButtonElement>('download-resume').disabled = !resume
  el<HTMLButtonElement>('print-resume').disabled = !resume
  el<HTMLButtonElement>('generate-interview').disabled = !resume || !!busy
}

function renderMarkdown(markdown: string, target: HTMLElement) {
  const html = marked.parse(markdown, { async: false }) as string
  target.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'iframe', 'form', 'input', 'button', 'style', 'svg', 'video', 'audio'], FORBID_ATTR: ['style', 'id', 'name'] })
  target.querySelectorAll('a').forEach(a => {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })
}

function updateResume(text: string, save = true) {
  materialsStale = false
  if (interview && text !== resume) interviewStaleFlag = true
  resume = text
  field('resume-editor').value = text
  el('resume-output').hidden = !text
  el('resume-empty').hidden = !!text
  renderMarkdown(text, el('resume-preview'))
  applyStaleNotices()
  updateSummary()
  if (save) saveDraftSoon()
}

function updateInterview(text: string, save = true) {
  interviewStaleFlag = false
  interview = text
  field('interview-editor').value = text
  el('interview-output').hidden = !text
  renderMarkdown(text, el('interview-preview'))
  applyStaleNotices()
  if (save) saveDraftSoon()
}

function renderRepos() {
  const list = el('repo-list')
  if (!repos.length) {
    list.innerHTML = '<div class="empty-state compact"><span>' + icon('github') + '</span><h3>' + esc(t('emptyReposTitle')) + '</h3><p>' + esc(t('emptyReposBody1')) + '<br>' + esc(t('emptyReposBody2')) + '</p></div>'
    updateSummary()
    return
  }
  list.innerHTML = `<div class="repo-list-heading"><h3>${esc(t('chooseProjects'))}</h3><span>${esc(t('projectCount', { count: repos.length }))}</span></div>${repos.map((r, i) => `<article class="repo-card"><label class="repo-select"><input type="checkbox" data-repo="${i}" ${selected.has(i) ? 'checked' : ''}><span><strong>${esc(r.org ? `${r.org}/${r.name}` : r.name)}</strong><small>${esc(t('mergedPrCount', { count: r.prs.length }))}${r.requestedPrCount && r.requestedPrCount > r.prs.length ? esc(t('partialRecords', { total: r.requestedPrCount })) : ''}</small></span></label><div class="repo-tech">${r.techStack.slice(0, 8).map(tech => `<span>${esc(tech)}</span>`).join('')}</div><div class="field-grid"><label>${esc(t('companyLabel'))}<input data-company="${i}" value="${esc(r.company || '')}" maxlength="120" placeholder="${esc(t('companyPlaceholder'))}"></label><label>${esc(t('periodLabel'))}<input data-period="${i}" value="${esc(r.period || '')}" maxlength="100" placeholder="${esc(t('periodPlaceholder'))}"></label></div><details class="pr-details"><summary>${esc(t('viewImportRecords'))}</summary><ul>${r.prs.map(pr => `<li><strong>${esc(pr.title)}</strong><span>${esc(pr.mergedAt.slice(0, 10))}</span></li>`).join('')}</ul></details></article>`).join('')}`
  list.querySelectorAll<HTMLInputElement>('[data-repo]').forEach(input => input.addEventListener('change', () => { const i = Number(input.dataset.repo); input.checked ? selected.add(i) : selected.delete(i); updateSummary(); markStale(); saveDraftSoon() }))
  list.querySelectorAll<HTMLInputElement>('[data-company]').forEach(input => input.addEventListener('input', () => { repos[Number(input.dataset.company)].company = input.value; markStale(); saveDraftSoon() }))
  list.querySelectorAll<HTMLInputElement>('[data-period]').forEach(input => input.addEventListener('input', () => { repos[Number(input.dataset.period)].period = input.value; markStale(); saveDraftSoon() }))
  updateSummary()
}

function markStale() {
  if (interview) interviewStaleFlag = true
  if (resume) materialsStale = true
  applyStaleNotices()
}

function saveDraftSoon() {
  if (!el<HTMLInputElement>('save-draft').checked) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(saveDraft, 500)
}

function saveDraft() {
  if (!el<HTMLInputElement>('save-draft').checked) return
  try {
    const fields = Object.fromEntries(savedFields.map(id => [id, field(id).value]))
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, fields, repos, selected: [...selected], resume, interview, materialsChanged: materialsStale, interviewChanged: interviewStaleFlag }))
    draftStatus = 'saved'
    applyDraftStatus()
  } catch {
    draftStatus = 'failed'
    applyDraftStatus()
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.version !== 1 || !data.fields || typeof data.fields !== 'object') return
    savedFields.forEach(id => { if (typeof data.fields[id] === 'string') field(id).value = data.fields[id] })
    if (Array.isArray(data.repos) && data.repos.length) repos = parseCacheJson(JSON.stringify({ repos: data.repos }))
    selected = new Set(Array.isArray(data.selected) ? data.selected.filter((i: unknown) => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < repos.length) : [])
    if (typeof data.resume === 'string') updateResume(data.resume, false)
    if (typeof data.interview === 'string') updateInterview(data.interview, false)
    if (data.materialsChanged && resume) { materialsStale = true; applyStaleNotices() }
    if (data.interviewChanged && interview) { interviewStaleFlag = true; applyStaleNotices() }
    el<HTMLInputElement>('save-draft').checked = true
    draftStatus = 'restored'
    applyDraftStatus()
  } catch {
    status(t('draftUnreadable'), 'error')
  }
}

function setBusy(next: typeof busy) {
  busy = next
  ;[...savedFields, 'api-key', 'github-token', 'resume-editor', 'interview-editor'].forEach(id => { (field(id) as HTMLInputElement).disabled = !!next })
  el('repo-list').querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !!next })
  el('cancel-interview').hidden = next !== 'interview'
  el<HTMLButtonElement>('import-github').disabled = !!next
  el<HTMLButtonElement>('generate').disabled = !!next
  el<HTMLButtonElement>('demo').disabled = !!next
  el<HTMLInputElement>('cache-file').disabled = !!next
  el('cancel-github').hidden = next !== 'github'
  el('cancel-generation').hidden = next !== 'resume'
  el('generate').innerHTML = next === 'resume' ? '<span class="spinner"></span> ' + esc(t('generatingResume')) : icon('spark') + ' ' + esc(t('generateResume'))
  el('import-github').innerHTML = next === 'github' ? '<span class="spinner"></span> ' + esc(t('importingProjects')) : icon('github') + ' ' + esc(t('importGithub'))
  el('generate-interview').innerHTML = next === 'interview' ? '<span class="spinner"></span> ' + esc(t('preparingInterview')) : icon('spark') + ' ' + esc(t('generateInterview'))
  const localeSelect = document.getElementById('locale-select') as HTMLSelectElement | null
  if (localeSelect) localeSelect.disabled = !!next
  updateSummary()
}

function message(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return t('cancelled')
  return error instanceof Error ? error.message : t('operationFailed')
}

function modelConfig() {
  if (!value('api-key')) throw new Error(t('needApiKey'))
  if (!value('model')) throw new Error(t('needModel'))
  return { provider: value('provider') as Provider, model: value('model'), apiKey: value('api-key') }
}

function download(text: string, suffix: string) {
  if (!text) return
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(value('name') || 'easy-offer').replace(/[^\p{L}\p{N}_-]/gu, '_')}-${suffix}.md`
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function changeLocale(next: Locale): void {
  if (next === getLocale()) return
  const fields = captureFields()
  setLocale(next)
  persistLocale(next)
  syncLocalePath(next, 'push')
  applyDocumentMeta(next)
  renderApp(fields)
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('[data-step], [data-next]').forEach(b => b.addEventListener('click', () => goto(Number(b.dataset.step ?? b.dataset.next))))
  document.querySelector('.brand')!.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) })
  savedFields.forEach(id => field(id).addEventListener('input', () => { updateSummary(); if (id !== 'provider' && id !== 'model') markStale(); saveDraftSoon() }))
  field('provider').addEventListener('change', () => {
    field('model').value = PROVIDERS.find(p => p.id === value('provider'))?.defaultModel || ''
    el<HTMLInputElement>('api-key').value = ''
    el<HTMLInputElement>('api-key').type = 'password'
    el('toggle-key').setAttribute('aria-label', t('showApiKey'))
    el('toggle-key').setAttribute('aria-pressed', 'false')
    status(t('providerSwitched'))
    saveDraftSoon()
  })
  el('toggle-key').addEventListener('click', () => {
    const input = el<HTMLInputElement>('api-key')
    const showing = input.type === 'password'
    input.type = showing ? 'text' : 'password'
    el('toggle-key').setAttribute('aria-label', showing ? t('hideApiKey') : t('showApiKey'))
    el('toggle-key').setAttribute('aria-pressed', String(showing))
  })
  el('save-draft').addEventListener('change', () => {
    if (el<HTMLInputElement>('save-draft').checked) saveDraft()
    else {
      clearTimeout(draftTimer)
      try { localStorage.removeItem(STORAGE_KEY) } catch {}
      draftStatus = 'stopped'
      applyDraftStatus()
    }
  })
  el('clear-draft').addEventListener('click', () => {
    clearTimeout(draftTimer)
    try {
      localStorage.removeItem(STORAGE_KEY)
      el<HTMLInputElement>('save-draft').checked = false
      draftStatus = 'cleared'
      applyDraftStatus()
    } catch {
      draftStatus = 'clear-failed'
      applyDraftStatus()
    }
  })
  el('resume-editor').addEventListener('input', () => { resume = field('resume-editor').value; if (interview) { interviewStaleFlag = true; applyStaleNotices() } renderMarkdown(resume, el('resume-preview')); updateSummary(); saveDraftSoon() })
  el('interview-editor').addEventListener('input', () => { interview = field('interview-editor').value; renderMarkdown(interview, el('interview-preview')); saveDraftSoon() })
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.addEventListener('click', () => { resumeView = b.dataset.view === 'edit' ? 'edit' : 'preview'; applyResumeView() }))
  el('import-github').addEventListener('click', async () => {
    if (busy) return
    if (!value('github')) { status(t('needGithubUser'), 'error'); field('github').focus(); return }
    if (!value('from') || !value('to') || value('from') > value('to')) { status(t('needValidDates'), 'error'); return }
    controller = new AbortController(); setBusy('github'); status(t('importingStatus'))
    try {
      const result = await importGitHub({ username: value('github'), token: value('github-token') || undefined, from: value('from'), to: value('to') }, controller.signal)
      repos = result.repos; selected = new Set(repos.map((_, i) => i)); renderRepos(); markStale(); saveDraftSoon()
      status(`${repos.length ? t('importedProjects', { count: repos.length }) : t('noProjectsInRange')}${result.truncated ? t('partialImportNote') : ''}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`, 'success')
    } catch (error) { status(message(error), 'error') } finally { setBusy(null); controller = null }
  })
  el('cache-file').addEventListener('change', async e => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || busy) return
    setBusy('cache')
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error(t('cacheFileTooLarge'))
      repos = parseCacheJson(await file.text()); selected = new Set(repos.map((_, i) => i)); renderRepos(); markStale(); saveDraftSoon(); status(t('cacheImported', { count: repos.length }), 'success')
    } catch (error) { status(message(error), 'error') } finally { input.value = ''; setBusy(null) }
  })
  el('cancel-github').addEventListener('click', () => controller?.abort())
  el('cancel-generation').addEventListener('click', () => controller?.abort())
  el('cancel-interview').addEventListener('click', () => controller?.abort())
  el('generate').addEventListener('click', async () => {
    if (busy) return
    try {
      if (!value('name')) { goto(0); field('name').focus(); throw new Error(t('needName')) }
      const selectedRepos = repos.filter((_, i) => selected.has(i))
      if (!value('experience') && !selectedRepos.length) { goto(0); field('experience').focus(); throw new Error(t('needExperience')) }
      const config = modelConfig()
      const profile: UserProfile = { name: value('name'), email: value('email'), phone: value('phone'), github: value('github') || undefined }
      const messages = buildWebResumeMessages({ profile, role: value('role') as RoleKey, jd: value('jd'), experience: value('experience'), education: value('education'), repos: selectedRepos })
      controller = new AbortController(); setBusy('resume'); status(t('generatingResumeStatus'))
      const result = await chat(config, messages, controller.signal)
      updateResume(result); activeArtifact = 'resume'; status(t('resumeGenerated'), 'success')
      el('resume-output').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) { status(message(error), 'error') } finally { setBusy(null); controller = null }
  })
  el('generate-interview').addEventListener('click', async () => {
    if (busy || !resume) return
    try {
      const config = modelConfig(); controller = new AbortController(); setBusy('interview'); status(t('generatingInterviewStatus'))
      const result = await chat(config, buildWebInterviewMessages(resume, value('jd')), controller.signal)
      updateInterview(result); activeArtifact = 'interview'; status(t('interviewGenerated'), 'success')
      el('interview-output').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (error) { status(message(error), 'error'); if (!value('api-key')) goto(2) } finally { setBusy(null); controller = null }
  })
  el('download-resume').addEventListener('click', () => download(resume, 'resume'))
  el('download-interview').addEventListener('click', () => download(interview, 'interview-prep'))
  el('print-resume').addEventListener('click', () => {
    if (!resume) return
    activeArtifact = 'resume'
    renderMarkdown(resume, el('print-root'))
    document.title = t('printTitle', { name: value('name') || 'Easy Offer' })
    window.print()
    applyDocumentMeta()
  })
  el('demo').addEventListener('click', () => {
    if (busy) return
    const sample: Record<string, string> = { name: t('sampleName'), role: 'frontend', email: 'example@example.com', phone: '', github: '', jd: t('sampleJd'), experience: t('sampleExperience'), education: t('sampleEducation') }
    Object.entries(sample).forEach(([id, text]) => { field(id).value = text })
    repos = []; selected.clear(); renderRepos()
    updateResume(t('sampleResume'))
    updateInterview(''); goto(0); status(t('demoLoaded'), 'success'); saveDraftSoon()
  })
  el<HTMLSelectElement>('locale-select').addEventListener('change', event => {
    const next = (event.target as HTMLSelectElement).value
    if (next === 'zh' || next === 'en' || next === 'es' || next === 'ko' || next === 'ja') changeLocale(next)
  })
}

window.addEventListener('beforeprint', () => { renderMarkdown(activeArtifact === 'interview' ? interview : resume, el('print-root')) })
window.addEventListener('popstate', () => {
  if (!booted) return
  const next = localeFromPath(location.pathname) ?? detectLocale()
  if (next === getLocale()) return
  const fields = captureFields()
  setLocale(next)
  persistLocale(next)
  applyDocumentMeta(next)
  renderApp(fields)
})

initLocale()
renderApp()
restoreDraft()
renderRepos()
updateSummary()
booted = true
