import './style.css'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ROLES } from '../src/roles'
import type { RepoData, RoleKey, UserProfile } from '../src/types'
import { PROVIDERS, chat, importGitHub, buildWebResumeMessages, buildWebInterviewMessages, parseCacheJson } from './client'
import type { Provider } from './client'

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
let repos: RepoData[] = []
let selected = new Set<number>()
let resume = ''
let interview = ''
let step = 0
let busy: 'github' | 'cache' | 'resume' | 'interview' | null = null
let controller: AbortController | null = null
let draftTimer: ReturnType<typeof setTimeout> | undefined
let activeArtifact: 'resume' | 'interview' = 'resume'

el('app').innerHTML = `
<header class="site-header"><a class="brand" href="#" aria-label="Easy Offer 首页"><span class="brand-mark">e<span>↗</span></span><span>easy<span class="brand-light">offer</span><span class="brand-dot">.</span></span></a><div class="header-right"><span class="header-note">好工作，从讲好自己的故事开始</span><a class="github-link" href="https://github.com/kuangzixian/easy-offer" target="_blank" rel="noopener noreferrer" aria-label="查看 GitHub 开源项目">${icon('github')}<span>开源项目</span></a></div></header>
<main>
<section class="intro"><div><p class="eyebrow"><span></span> 为认真做事的人，写一份好简历</p><h1>你做过的事，<br>值得<span class="title-highlight">被看见<svg viewBox="0 0 280 15" aria-hidden="true"><path d="M3 11Q130-2 275 8"/></svg></span>。</h1><p class="intro-copy">从真实项目出发，整理经历、对齐岗位。<br>让代码背后的能力，成为简历里的底气。</p><button id="demo" class="text-button">试试示例材料 ${icon('arrow')}</button></div><div class="intro-visual" aria-hidden="true"><div class="paper-tag">你的下一份机会</div><div class="mini-resume"><div class="mini-heading">每一步，都算数<span>一份更有说服力的简历</span></div><div class="mini-line wide"></div><div class="mini-line"></div><div class="mini-section">真实经历 <span>→</span> 清晰表达</div><div class="mini-line wide"></div><div class="mini-line short"></div><div class="mini-section">技术贡献 <span>→</span> 项目价值</div><div class="mini-line"></div><div class="mini-line wide"></div></div><span class="visual-sticker">从事实出发<br>不凭空编造 ${icon('check')}</span></div></section>
<div class="workbench-top"><div><span class="section-kicker">你的简历工作台</span><span class="workbench-sub">一步一步，把经历变成机会</span></div><span class="cost-tag">自带 API Key · 按模型用量付费</span></div>
<nav class="steps" aria-label="简历制作步骤">${['准备材料', '选择项目', '生成与修改', '导出简历'].map((s, i) => `<button class="step${i === 0 ? ' active' : ''}" data-step="${i}" aria-current="${i === 0 ? 'step' : 'false'}"><span class="step-number">0${i + 1}</span><span>${s}</span>${i < 3 ? '<span class="step-arrow">↗</span>' : ''}</button>`).join('')}</nav>
<div id="status" class="status" role="status" aria-live="polite" hidden></div>
<div class="workspace"><div class="main-panel">
<section id="step-0" class="step-panel" aria-labelledby="heading-0"><div class="panel-heading"><div><p class="section-kicker">01 / 准备材料</p><h2 id="heading-0">先认识真实的你</h2><p>写下已有的经历，不必一开始就写得漂亮。</p></div><span class="panel-icon">${icon('file')}</span></div>
<div class="field-grid"><label>你的名字 <span class="required">*</span><input id="name" placeholder="简历上如何称呼你" maxlength="80" autocomplete="name"></label><label>目标方向<select id="role">${ROLES.map(r => `<option value="${r.key}"${r.key === 'node' ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label><label>邮箱 <span class="optional">选填</span><input id="email" type="email" placeholder="用于接收工作机会" autocomplete="email" maxlength="160"></label><label>电话 <span class="optional">选填</span><input id="phone" type="tel" placeholder="你的联系电话" autocomplete="tel" maxlength="40"></label></div>
<div class="field-divider"></div>
<label>目标岗位描述 <span class="optional">选填</span><span class="field-hint">粘贴招聘 JD，帮助简历突出相关能力。最多 10,000 字。</span><textarea id="jd" rows="5" maxlength="10000" placeholder="例如：负责 Node.js 服务端开发，熟悉 TypeScript、数据库设计和服务性能优化……"></textarea></label>
<label class="spaced-label">工作与项目经历 <span class="optional">可直接填写，不必连接 GitHub</span><span class="field-hint">公司 / 时间 / 做过什么 / 你的贡献 / 有依据的结果。只写能确认的事实，最多 12,000 字。</span><textarea id="experience" rows="7" maxlength="12000" placeholder="2023.06—至今 ｜ 某公司 ｜ 后端工程师\n项目：订单服务重构\n我负责：拆分支付回调流程，补充幂等处理与失败重试。\n结果：请填写有记录支持的指标；没有数字，也可以描述具体改进。"></textarea></label>
<label class="spaced-label">教育经历 <span class="optional">选填</span><textarea id="education" rows="2" maxlength="3000" placeholder="学校 · 专业 · 学历 · 起止时间（最多 3,000 字）"></textarea></label>
<div class="panel-footer"><span>已有项目材料？下一步可以从 GitHub 导入。</span><button class="button primary" data-next="1">下一步，选择项目 ${icon('arrow')}</button></div></section>
<section id="step-1" class="step-panel" aria-labelledby="heading-1" hidden><div class="panel-heading"><div><p class="section-kicker">02 / 选择项目</p><h2 id="heading-1">让项目替你说话</h2><p>导入已合并的 PR，选择真正想展示的贡献。</p></div><span class="panel-icon">${icon('github')}</span></div>
<div class="soft-note">${icon('lock')}<p>GitHub 导入是可选的。已经填写工作经历，可以直接跳过这一步。Token 只在本次页面中使用，不保存到草稿。</p></div>
<div class="field-grid"><label class="full-width">GitHub 用户名<input id="github" placeholder="例如 octocat" autocapitalize="off" spellcheck="false" maxlength="80"></label><label>开始日期<input id="from" type="date" value="${from}"></label><label>结束日期<input id="to" type="date" value="${today}"></label></div>
<details class="advanced"><summary>访问令牌（可选）</summary><label>GitHub Token<input id="github-token" type="password" placeholder="仅在需要访问权限或更高请求额度时填写" autocomplete="off" spellcheck="false" autocapitalize="off"></label><p class="field-hint">仅授权需要导入的仓库。导入结果可能包含私有项目内容，请确认有权将所选材料发送给 AI 服务商。</p></details>
<div class="import-actions"><button id="import-github" class="button primary">${icon('github')} 导入 GitHub 项目</button><label class="button secondary upload-label">${icon('upload')} 导入已有缓存<input id="cache-file" type="file" accept=".json,application/json" class="visually-hidden"></label><button id="cancel-github" class="text-button cancel-button" hidden>取消导入</button></div>
<p class="field-hint import-note">支持 easy-offer CLI 生成的 .github-resume-cache.json。导入前请移除不需要的个人或公司信息。</p>
<div id="repo-list"></div>
<div class="panel-footer"><button class="text-button" data-next="0">← 返回材料</button><button class="button primary" data-next="2">下一步，生成简历 ${icon('arrow')}</button></div></section>
<section id="step-2" class="step-panel" aria-labelledby="heading-2" hidden><div class="panel-heading"><div><p class="section-kicker">03 / 生成与修改</p><h2 id="heading-2">把经历，写得更清楚</h2><p>选择你的模型，让 AI 整理表达，再由你把关事实。</p></div><span class="panel-icon">${icon('spark')}</span></div>
<div class="model-config"><div class="field-grid"><label>模型服务商<select id="provider">${PROVIDERS.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label><label>模型名称<input id="model" value="${esc(PROVIDERS[0]?.defaultModel || '')}" placeholder="填写该服务商支持的模型" maxlength="120" spellcheck="false"></label><label class="full-width">你的 API Key<div class="password-wrap"><input id="api-key" type="password" placeholder="只保留在当前页面，刷新后清除" autocomplete="off" spellcheck="false" autocapitalize="off"><button id="toggle-key" type="button" aria-label="显示 API Key" aria-pressed="false">${icon('eye')}</button></div></label></div><p class="privacy-copy">${icon('lock')}<span>点击生成后，所填材料、选中的 PR 与 API Key 将经过本站后端，转交你选择的模型服务商。本站服务端不保存密钥或生成记录。模型费用由你的服务商账户承担；DeepSeek 使用非思考模式，减少等待和用量。请先移除敏感信息。</span></p><p class="field-hint sampling-note">为控制用量，每个项目最多参考最近 30 条 PR、每条正文前 1,000 字符；项目证据总预算 20,000 字符。导入记录不等于全部职业经历。</p><div class="generation-actions"><button id="generate" class="button primary">${icon('spark')} 生成我的简历</button><button id="cancel-generation" class="text-button cancel-button" hidden>取消生成</button><span id="generation-state" class="field-hint">通常需要几十秒，请留在当前页面。</span></div></div>
<p id="stale-notice" class="stale-notice" hidden>材料已修改，当前简历仍是之前的版本。请重新生成，或手动更新后再导出。</p><div id="resume-output" class="output-area" hidden><div class="output-heading"><h3>你的简历草稿</h3><div class="view-tabs" role="group" aria-label="简历显示方式"><button class="active" data-view="preview">预览</button><button data-view="edit">编辑 Markdown</button></div></div><p class="field-hint">检查日期、职责与数字。AI 可能理解有误，确认后再用于投递。</p><textarea id="resume-editor" class="markdown-editor" aria-label="编辑简历 Markdown" spellcheck="false" hidden></textarea><article id="resume-preview" class="document-preview"></article></div>
<div id="resume-empty" class="empty-state"><span>${icon('file')}</span><h3>下一份简历，从这里开始</h3><p>准备好材料和 API Key，点击上方生成。<br>也可以先试试示例，看看最终效果。</p></div>
<div class="panel-footer"><button class="text-button" data-next="1">← 返回项目</button><button class="button primary" data-next="3">下一步，导出 ${icon('arrow')}</button></div></section>
<section id="step-3" class="step-panel" aria-labelledby="heading-3" hidden><div class="panel-heading"><div><p class="section-kicker">04 / 导出简历</p><h2 id="heading-3">准备好，去找新机会</h2><p>带走简历，也为即将到来的面试做一点准备。</p></div><span class="panel-icon">${icon('download')}</span></div>
<p id="export-stale" class="stale-notice" hidden>材料已修改，当前简历仍是之前的版本。导出前请确认文稿已同步更新。</p><div class="export-cards"><div class="export-card"><span class="export-icon">${icon('file')}</span><h3>简历 Markdown</h3><p>保留可编辑的原稿，随时调整、更新经历。</p><button id="download-resume" class="button secondary">${icon('download')} 下载 Markdown</button></div><div class="export-card"><span class="export-icon">${icon('book')}</span><h3>简历 PDF</h3><p>调用浏览器打印，目标选择“另存为 PDF”。</p><button id="print-resume" class="button secondary">${icon('download')} 打印 / 保存 PDF</button></div></div>
<div class="interview-callout"><div><p class="section-kicker">多准备一步</p><h3>让面试，也更有底气</h3><p>基于当前简历与 JD，整理可能被追问的问题和准备方向。使用上一步填写的模型与密钥，会产生额外模型用量。</p></div><div class="interview-actions"><button id="generate-interview" class="button primary">${icon('spark')} 生成面试准备</button><button id="cancel-interview" class="text-button cancel-button" hidden>取消生成</button></div></div>
<div id="interview-output" hidden><p id="interview-stale" class="stale-notice" hidden>简历或岗位材料已变化，这份面试准备仍基于上一版。可以保留参考，或重新生成。</p><div class="output-heading"><h3>面试准备清单</h3><button id="download-interview" class="button secondary small">${icon('download')} 下载 Markdown</button></div><label class="spaced-label">编辑面试准备<textarea id="interview-editor" class="markdown-editor compact" spellcheck="false"></textarea></label><article id="interview-preview" class="document-preview"></article></div>
<div class="panel-footer"><button class="text-button" data-next="2">← 返回编辑简历</button><span>真实的经历，就是你的优势。</span></div></section>
</div>
<aside class="workspace-aside"><div class="aside-card"><span class="aside-label">这一份，属于你</span><h3 id="summary-name">从一张白纸开始</h3><p id="summary-role">Node.js 工程师</p><div class="summary-stats"><div><strong id="summary-repos">0</strong><span>个所选项目</span></div><div><strong id="summary-prs">0</strong><span>条合并记录</span></div></div><div class="aside-divider"></div><ul class="guidelines"><li>${icon('check')}从真实经历中找到亮点</li><li>${icon('check')}为目标岗位调整表达</li><li>${icon('check')}每个数字，都有依据</li></ul></div><div class="draft-card">${icon('lock')}<h3>材料由你掌握</h3><p>默认只在当前页面保留。关闭或刷新页面，未保存的内容会丢失。</p><label class="checkbox-label"><input id="save-draft" type="checkbox"><span>在此浏览器保存草稿</span></label><p class="field-hint">包括个人资料、项目和文稿，不包含任何密钥。共用设备建议关闭。</p><button id="clear-draft" class="text-button">清除已保存草稿</button><span id="draft-state" class="draft-state" aria-live="polite"></span></div><div class="aside-quote">“不是经历不够好，<br>是它还没被好好讲述。”<span>写简历，也是重新认识自己。</span></div></aside></div>
</main><footer class="site-footer"><span>easyoffer. <span class="footer-muted">把认真做过的事，好好写下来。</span></span><a href="https://github.com/kuangzixian/easy-offer" target="_blank" rel="noopener noreferrer">开源，自由使用 ↗</a></footer>`

const savedFields = ['name', 'role', 'email', 'phone', 'jd', 'experience', 'education', 'github', 'from', 'to', 'provider', 'model'] as const
function status(message: string, kind: 'success' | 'error' | 'info' = 'info') {
  el('status').textContent = message
  el('status').className = `status ${kind}`
  el('status').hidden = !message
}
function goto(next: number, scroll = true) {
  step = next
  document.querySelectorAll<HTMLElement>('.step-panel').forEach((p, i) => p.hidden = i !== step)
  document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b, i) => {
    b.classList.toggle('active', i === step)
    b.classList.toggle('completed', i < step)
    b.setAttribute('aria-current', i === step ? 'step' : 'false')
  })
  if (scroll) document.querySelector('.steps')!.scrollIntoView({ behavior: 'smooth', block: 'start' })
  updateSummary()
}
function updateSummary() {
  el('summary-name').textContent = value('name') || '从一张白纸开始'
  el('summary-role').textContent = ROLES.find(r => r.key === value('role'))?.label || ''
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
  el('stale-notice').hidden = true
  el('export-stale').hidden = true
  if (interview && text !== resume) el('interview-stale').hidden = false
  resume = text
  field('resume-editor').value = text
  el('resume-output').hidden = !text
  el('resume-empty').hidden = !!text
  renderMarkdown(text, el('resume-preview'))
  updateSummary()
  if (save) saveDraftSoon()
}
function updateInterview(text: string, save = true) {
  el('interview-stale').hidden = true
  interview = text
  field('interview-editor').value = text
  el('interview-output').hidden = !text
  renderMarkdown(text, el('interview-preview'))
  if (save) saveDraftSoon()
}
function renderRepos() {
  const list = el('repo-list')
  if (!repos.length) { list.innerHTML = '<div class="empty-state compact"><span>' + icon('github') + '</span><h3>给做过的项目留个位置</h3><p>导入后可选择项目、补全公司与任职时间。<br>没有 GitHub 记录也没关系，直接使用文字经历即可。</p></div>'; updateSummary(); return }
  list.innerHTML = `<div class="repo-list-heading"><h3>选择要写进简历的项目</h3><span>${repos.length} 个项目</span></div>${repos.map((r, i) => `<article class="repo-card"><label class="repo-select"><input type="checkbox" data-repo="${i}" ${selected.has(i) ? 'checked' : ''}><span><strong>${esc(r.org ? `${r.org}/${r.name}` : r.name)}</strong><small>${r.prs.length} 条已合并 PR${r.requestedPrCount && r.requestedPrCount > r.prs.length ? ` · 原记录 ${r.requestedPrCount} 条，当前为部分数据` : ''}</small></span></label><div class="repo-tech">${r.techStack.slice(0, 8).map(t => `<span>${esc(t)}</span>`).join('')}</div><div class="field-grid"><label>对应公司<input data-company="${i}" value="${esc(r.company || '')}" maxlength="120" placeholder="开源 / 个人项目，或公司名称"></label><label>工作时间<input data-period="${i}" value="${esc(r.period || '')}" maxlength="100" placeholder="例如 2023.06—至今"></label></div><details class="pr-details"><summary>查看导入记录</summary><ul>${r.prs.map(pr => `<li><strong>${esc(pr.title)}</strong><span>${esc(pr.mergedAt.slice(0, 10))}</span></li>`).join('')}</ul></details></article>`).join('')}`
  list.querySelectorAll<HTMLInputElement>('[data-repo]').forEach(input => input.addEventListener('change', () => { const i = Number(input.dataset.repo); input.checked ? selected.add(i) : selected.delete(i); updateSummary(); markStale(); saveDraftSoon() }))
  list.querySelectorAll<HTMLInputElement>('[data-company]').forEach(input => input.addEventListener('input', () => { repos[Number(input.dataset.company)].company = input.value; markStale(); saveDraftSoon() }))
  list.querySelectorAll<HTMLInputElement>('[data-period]').forEach(input => input.addEventListener('input', () => { repos[Number(input.dataset.period)].period = input.value; markStale(); saveDraftSoon() }))
  updateSummary()
}
function markStale() {
  if (interview) el('interview-stale').hidden = false
  if (resume) { el('stale-notice').hidden = false; el('export-stale').hidden = false }
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, fields, repos, selected: [...selected], resume, interview, materialsChanged: !el('stale-notice').hidden, interviewChanged: !el('interview-stale').hidden }))
    el('draft-state').textContent = '草稿已保存在此浏览器'
  } catch { el('draft-state').textContent = '未能保存草稿，可能是浏览器存储空间不足。请及时导出文稿。' }
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
    if (data.materialsChanged && resume) markStale()
    if (data.interviewChanged && interview) el('interview-stale').hidden = false
    el<HTMLInputElement>('save-draft').checked = true
    el('draft-state').textContent = '已恢复此浏览器中的草稿'
  } catch { status('已保存的草稿无法读取。你可以清除草稿后重新开始。', 'error') }
}
function setBusy(next: typeof busy) {
  busy = next
  ;[...savedFields, 'api-key', 'github-token', 'resume-editor', 'interview-editor'].forEach(id => { (field(id) as HTMLInputElement).disabled = !!next })
  el('repo-list').querySelectorAll<HTMLInputElement>('input').forEach(input => input.disabled = !!next)
  el('cancel-interview').hidden = next !== 'interview'
  el<HTMLButtonElement>('import-github').disabled = !!next
  el<HTMLButtonElement>('generate').disabled = !!next
  el<HTMLButtonElement>('demo').disabled = !!next
  el<HTMLInputElement>('cache-file').disabled = !!next
  el('cancel-github').hidden = next !== 'github'
  el('cancel-generation').hidden = next !== 'resume'
  el('generate').innerHTML = next === 'resume' ? '<span class="spinner"></span> 正在整理你的经历…' : icon('spark') + ' 生成我的简历'
  el('import-github').innerHTML = next === 'github' ? '<span class="spinner"></span> 正在导入项目…' : icon('github') + ' 导入 GitHub 项目'
  el('generate-interview').innerHTML = next === 'interview' ? '<span class="spinner"></span> 正在准备问题…' : icon('spark') + ' 生成面试准备'
  updateSummary()
}
function message(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '已取消。已有材料和文稿仍然保留。'
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。'
}
function modelConfig() {
  if (!value('api-key')) throw new Error('请先填写你自己的 API Key。密钥仅保留在当前页面。')
  if (!value('model')) throw new Error('请填写模型名称。')
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

document.querySelectorAll<HTMLButtonElement>('[data-step], [data-next]').forEach(b => b.addEventListener('click', () => goto(Number(b.dataset.step ?? b.dataset.next))))
document.querySelector('.brand')!.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) })
savedFields.forEach(id => field(id).addEventListener('input', () => { updateSummary(); if (id !== 'provider' && id !== 'model') markStale(); saveDraftSoon() }))
field('provider').addEventListener('change', () => {
  field('model').value = PROVIDERS.find(p => p.id === value('provider'))?.defaultModel || ''
  el<HTMLInputElement>('api-key').value = ''
  el<HTMLInputElement>('api-key').type = 'password'
  el('toggle-key').setAttribute('aria-label', '显示 API Key')
  el('toggle-key').setAttribute('aria-pressed', 'false')
  status('已切换服务商，原 API Key 已清除。请填写对应服务商的密钥。')
  saveDraftSoon()
})
el('toggle-key').addEventListener('click', () => { const input = el<HTMLInputElement>('api-key'); const showing = input.type === 'password'; input.type = showing ? 'text' : 'password'; el('toggle-key').setAttribute('aria-label', showing ? '隐藏 API Key' : '显示 API Key'); el('toggle-key').setAttribute('aria-pressed', String(showing)) })
el('save-draft').addEventListener('change', () => { if (el<HTMLInputElement>('save-draft').checked) saveDraft(); else { clearTimeout(draftTimer); try { localStorage.removeItem(STORAGE_KEY) } catch {} el('draft-state').textContent = '已停止保存，浏览器中的旧草稿已清除' } })
el('clear-draft').addEventListener('click', () => { clearTimeout(draftTimer); try { localStorage.removeItem(STORAGE_KEY); el<HTMLInputElement>('save-draft').checked = false; el('draft-state').textContent = '已清除保存的草稿，当前页面内容仍然保留' } catch { el('draft-state').textContent = '清除失败，请在浏览器设置中清除此站点数据' } })
el('resume-editor').addEventListener('input', () => { resume = field('resume-editor').value; if (interview) el('interview-stale').hidden = false; renderMarkdown(resume, el('resume-preview')); updateSummary(); saveDraftSoon() })
el('interview-editor').addEventListener('input', () => { interview = field('interview-editor').value; renderMarkdown(interview, el('interview-preview')); saveDraftSoon() })
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.addEventListener('click', () => { const editing = b.dataset.view === 'edit'; el('resume-editor').hidden = !editing; el('resume-preview').hidden = editing; document.querySelectorAll('[data-view]').forEach(t => t.classList.toggle('active', t === b)) }))
el('import-github').addEventListener('click', async () => {
  if (busy) return
  if (!value('github')) { status('请填写 GitHub 用户名。', 'error'); field('github').focus(); return }
  if (!value('from') || !value('to') || value('from') > value('to')) { status('请检查开始和结束日期。', 'error'); return }
  controller = new AbortController(); setBusy('github'); status('正在读取 GitHub 合并记录，请稍候。')
  try {
    const result = await importGitHub({ username: value('github'), token: value('github-token') || undefined, from: value('from'), to: value('to') }, controller.signal)
    repos = result.repos; selected = new Set(repos.map((_, i) => i)); renderRepos(); markStale(); saveDraftSoon()
    status(`${repos.length ? `已导入 ${repos.length} 个项目，可取消不想展示的项目。` : '这个时间段未找到可导入的项目。你也可以手动填写经历。'}${result.truncated ? ' 为控制请求与材料长度，本次为部分记录。' : ''}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`, 'success')
  } catch (error) { status(message(error), 'error') } finally { setBusy(null); controller = null }
})
el('cache-file').addEventListener('change', async e => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy) return
  setBusy('cache')
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('缓存文件过大，请选择不超过 4 MB 的 JSON 文件。')
    repos = parseCacheJson(await file.text()); selected = new Set(repos.map((_, i) => i)); renderRepos(); markStale(); saveDraftSoon(); status(`已导入 ${repos.length} 个项目。请核对公司与工作时间。`, 'success')
  } catch (error) { status(message(error), 'error') } finally { input.value = ''; setBusy(null) }
})
el('cancel-github').addEventListener('click', () => controller?.abort())
el('cancel-generation').addEventListener('click', () => controller?.abort())
el('cancel-interview').addEventListener('click', () => controller?.abort())
el('generate').addEventListener('click', async () => {
  if (busy) return
  try {
    if (!value('name')) { goto(0); field('name').focus(); throw new Error('请先填写简历上的名字。') }
    const selectedRepos = repos.filter((_, i) => selected.has(i))
    if (!value('experience') && !selectedRepos.length) { goto(0); field('experience').focus(); throw new Error('请先填写工作或项目经历，或导入并选择 GitHub 项目。') }
    const config = modelConfig()
    const profile: UserProfile = { name: value('name'), email: value('email'), phone: value('phone'), github: value('github') || undefined }
    const messages = buildWebResumeMessages({ profile, role: value('role') as RoleKey, jd: value('jd'), experience: value('experience'), education: value('education'), repos: selectedRepos })
    controller = new AbortController(); setBusy('resume'); status('正在生成简历。已有草稿会保留，直到收到新的生成结果。')
    const result = await chat(config, messages, controller.signal)
    updateResume(result); activeArtifact = 'resume'; status('简历草稿已生成。请检查事实，切换到“编辑 Markdown”即可修改。', 'success')
    el('resume-output').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) { status(message(error), 'error') } finally { setBusy(null); controller = null }
})
el('generate-interview').addEventListener('click', async () => {
  if (busy || !resume) return
  try {
    const config = modelConfig(); controller = new AbortController(); setBusy('interview'); status('正在根据简历与目标岗位整理面试问题。')
    const result = await chat(config, buildWebInterviewMessages(resume, value('jd')), controller.signal)
    updateInterview(result); activeArtifact = 'interview'; status('面试准备已生成，可以继续编辑或下载。', 'success')
    el('interview-output').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) { status(message(error), 'error'); if (!value('api-key')) goto(2) } finally { setBusy(null); controller = null }
})
el('download-resume').addEventListener('click', () => download(resume, 'resume'))
el('download-interview').addEventListener('click', () => download(interview, 'interview-prep'))
el('print-resume').addEventListener('click', () => { if (!resume) return; activeArtifact = 'resume'; renderMarkdown(resume, el('print-root')); document.title = `${value('name') || 'Easy Offer'} · 简历`; window.print(); document.title = 'Easy Offer · 让好工作被看见' })
window.addEventListener('beforeprint', () => { renderMarkdown(activeArtifact === 'interview' ? interview : resume, el('print-root')) })
el('demo').addEventListener('click', () => {
  if (busy) return
  const sample: Record<string, string> = { name: '林小满（虚构示例）', role: 'frontend', email: 'example@example.com', phone: '', github: '', jd: '招聘前端工程师，负责协作工具的 Web 产品开发。熟悉 TypeScript、React，重视可访问性和用户体验。', experience: '以下内容完全虚构，仅演示填写方式。\n2023.07—2025.06 ｜ 山间工作室（虚构）｜ 前端工程师\n项目：团队协作看板\n负责：任务编辑、筛选和拖拽交互；补充键盘导航和空状态。\n结果：统一了任务状态模型，支持用户用键盘完成主要操作。未提供量化数据。', education: '示例大学（虚构） · 计算机科学 · 本科 · 2019—2023' }
  Object.entries(sample).forEach(([id, text]) => { field(id).value = text })
  repos = []; selected.clear(); renderRepos()
  updateResume('# 林小满\n\n> 虚构示例，仅用于演示；未调用 AI，不可作为真实经历投递。\n\n**前端工程师** · example@example.com\n\n## 个人简介\n\n使用 TypeScript 与 React 开发 Web 产品，关注交互体验与可访问性。\n\n## 工作经历\n\n### 山间工作室（虚构） · 前端工程师\n\n2023.07—2025.06\n\n**团队协作看板**\n\n- 负责任务编辑、筛选与拖拽交互，整理任务状态模型，使页面行为保持一致。\n- 为主要操作补充键盘导航与清晰的空状态，完善不同使用方式下的交互体验。\n- 与设计同学共同梳理组件状态，将公共交互整理为可复用组件。\n\n## 技术能力\n\nTypeScript · React · Web 可访问性 · 组件开发\n\n## 教育经历\n\n示例大学（虚构） · 计算机科学 · 本科 · 2019—2023')
  updateInterview(''); goto(0); status('已填入虚构示例，未调用任何 API，也不产生模型费用。可在第 3 步预览示例简历。', 'success'); saveDraftSoon()
})
restoreDraft(); renderRepos(); updateSummary()
