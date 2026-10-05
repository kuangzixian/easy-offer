# easy-offer

**把真实项目经历，整理成更贴合目标岗位的简历。**

## 手机网页版

**在线使用：[easy-offer.kznb.workers.dev](https://easy-offer.kznb.workers.dev/)**

新增适配手机和桌面的 Web 工作台，原有 CLI 仍可使用。

- 准备岗位、JD、个人信息与工作经历；也可以不用 GitHub，直接粘贴项目素材。
- 导入 GitHub 已合并 PR 或 CLI 缓存 JSON，选择需要使用的项目。
- 使用自己的模型 API Key 生成简历与面试准备，逐段编辑 Markdown 并预览。
- 下载 Markdown，或用浏览器打印功能保存为 PDF。
- 可选择在当前浏览器保存草稿；模型 Key 和 GitHub Token 不进入草稿，刷新后需重新填写。

模型调用通过 Cloudflare Worker 临时转发到使用者选择的服务商，费用由该使用者的 API 账号承担。本站不配置共享模型 Key，不建用户数据库，不在服务端保存简历。点击生成时，会把选中的项目材料和填写的信息发送给所选模型服务商。供应商的数据留存规则由其自身政策决定。

Web 首版以文本输入为主；CLI 的截图 OCR、旧简历 PDF 自动解析尚未迁移到网页。GitHub 导入有采样上限，页面显示实际导入与采纳范围；模型结果仍需本人核对。

开发和部署要求 Node.js 22 或更新版本：

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm run build:web
npm run dev:api
```

打开终端显示的本地地址。需要热更新时另开终端运行 `npm run dev:web`。

完整部署、数据流及验证方法见 [Web 部署说明](docs/web-deployment.md)。以下为原 CLI 使用说明。

> 一个专为**工程师**打造的 AI 简历生成 CLI —— 不让你再盯着空白 Word 回忆"我那个项目做了啥"。

```
    你的 3847 条 merged PR ─┐
                           │
              +───────────▼───────────+
              │   easy-offer (AI)     │
              │   · 读 PR 正文        │       ┌─ resume.md
              │   · 按公司/时段分组   │──────▶├─ resume.pdf
              │   · 对齐 JD 关键词    │       └─ interview-prep.md
              │   · 量化成果提炼      │
              +───────────────────────+
                           ▲
         你的 JD 截图 ─────┘   (本地 OCR，不走云)
```

[English](#english) | [中文文档](#中文)

---

## 为什么需要它？

技术简历的 3 大痛点：
1. **记不起来细节**：两年前那个重构，具体提升了多少 QPS？哪个模块用了熔断？翻不动 Jira 和飞书文档
2. **不会写清价值**：工程师的 "fix: retry on 503" 可以展开说明重试策略、问题场景与验证结果；次数和恢复率只能引用实际记录
3. **一份简历投所有岗位**：投 Go 后端和投 AI Agent 应该是两份侧重完全不同的简历

**easy-offer 的流程：** 读取采样 PR 正文 → 按 FAB 模式（Feature/Advantage/Benefit）整理 → 结合目标 JD 调整表述 → 生成面试准备题。PR 搜索与提示词都有数量上限，不代表读取了全部历史或代码 diff。

---

## 30 秒看效果

### Before（你自己写的 PR 标题 + 正文）

```diff
+ feat(push): add redis-backed dedup for APNs deliveries
  
  Fix the issue that APNs sometimes sends duplicate pushes when
  the same device_token appears in multiple user campaigns.
  Use redis SETNX with 60s TTL as idempotency key.
  Before: ~3% duplicate rate. After: 0 dup over 24h window.
```

### After（easy-offer 生成的简历段落）

> #### 项目 1：推送去重改进
>
> - **背景**：同一设备出现在多个活动中时出现重复推送
> - **技术方案**：使用 Redis SETNX 与 60 秒 TTL 实现幂等去重
> - **结果**：改动前重复率约 3%；改动后的 24 小时观测窗口未发现重复推送
>
> 职责边界、业务规模及长期效果需本人补充真实证据，不能从这条 PR 推断。

同样的 PR 数据，生成 Go 后端 vs AI Agent vs 架构师简历，**侧重的技术关键词完全不同** —— 因为 prompt 里注入了岗位关键词库。

---

## 特色功能

| 能力 | 细节 |
|------|------|
| **FAB 写作框架** | 每段项目经历都隐含 Feature / Advantage / Benefit 三层，HR 秒懂价值 |
| **反幻觉** | 量化数字必须有 PR 依据，LLM 不会瞎编"千万 DAU" |
| **JD 对齐** | 贴一张 JD 截图 → 本地 tesseract.js OCR → LLM 去噪（自动剥离 BOSS 直聘 UI）→ 按 JD 关键词高亮 |
| **多 org 自动发现** | 不用手输组织名。一键搜索 `author:you is:merged` 的所有仓库，跨个人账号 + 任意 org |
| **智能时段映射** | 根据 PR 合并日期自动匹配到你 PDF 简历里的哪段工作经历 |
| **面试预测** | 基于你的简历 + JD，生成 **必考题 / 可能追问 / 行为题 / 反问面试官** 四类题 |
| **不锁死供应商** | OpenAI / DeepSeek / OpenRouter / 火山方舟 / 本地 Ollama 都能跑 |
| **本地优先** | OCR 本地跑，config 存 `~/.easy-offer/config.json`（mode 0600）。只有调 LLM 时才出网 |

---

## 快速开始

```bash
npx easy-offer        # 首次运行会引导配置 LLM
```

首次配置后，第二次起就是秒启动：

```
$ npx easy-offer
⠋ 验证 LLM 配置...
✓ LLM 配置有效

━━━━━━━━━━━━━━━━━━━━━━━━━━
  easy-offer v1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━

? [步骤 1/5] 你在面试哪个岗位？（可选，回车跳过） Agent 开发工程师
? 是否提供 JD？ 提供截图路径（本地 OCR，tesseract.js）
? 请输入截图文件路径（支持 ~/、JPEG/PNG/GIF/WEBP）: ~/Desktop/jd.jpg
⠏ 识别中 72%
✓ 识别 + 清洗完成，接下来请在编辑器中校对

✓ 推断工种：AI/Agent 工程师
? [步骤 3/5] 旧简历 PDF 路径（支持 ~/，回车跳过）: ~/Documents/resume.pdf
✓ 解析成功，检测到 4 段工作经历

[步骤 4/5] 设定 PR 拉取的时间范围
  从已解析的工作经历推断：2018-03-01 ~ 2026-04-21（可修改）
✓ 发现 23 个相关仓库，共 487 条 PR
⠙ 拉取 1/23 owner/repo-name...
```

---

## 面试题预测（interview-prep.md 片段）

```markdown
## 二、高频技术面试题

### 必考题（JD 直接提到的技术）
- Q: 你在幂等系统里怎么处理 Redis 宕机导致的去重失效？
  参考回答：兜底策略 + 降级为业务层校验 + 旁路告警...

### 大概率考（基于候选人项目经历可深挖）
- Q: 你说 APNs 重复率 3% 降到 0%，这个 0% 是怎么测量出来的？
  参考回答：采样 24h 的 device_token+campaign_id 哈希...

### 反向追问准备（体现思考深度）
- Q: 贵公司推送系统的 P99 延迟 SLA 是多少？
  用意：切入架构讨论，展示对生产指标的敏感度

## 四、行为题与软素质（二面常考）
- 沟通冲突类：与产品经理就 xxx 争议如何收敛的
- 项目挫折类：XX 项目上线事故复盘
- 成长动机类：为什么离职 / 为什么选这家
```

---

## 技术栈

- **Node.js 18+** / TypeScript / Commander
- **OpenAI SDK**（任何 OpenAI-compatible endpoint）
- **tesseract.js** 本地 OCR（chi_sim + eng）
- **pdf-parse** 抽取 PDF 文本
- **puppeteer** 生成 PDF 简历

---

## 适合谁

- ✓ 国内互联网技术岗求职者（Go / Node / Java / 前端 / iOS / Android / AI / 架构师）
- ✓ GitHub 上有**至少几十条** merged PR 的人（数据越多，AI 写出来越具体）
- ✓ 想同时投递多家 / 多岗位，需要批量定制化简历的人
- ✓ 觉得自己写简历像挤牙膏的人

不太适合：PR 基本只有 `Initial commit` 的新人（这种情况 AI 没有素材可提炼）。

---

## 安全与隐私

- LLM 配置存 `~/.easy-offer/config.json`，文件权限 `0600`
- **OCR 全程本地**，JD 截图不会上传任何服务
- `.gitignore` 已排除 `resume.md` / `resume.pdf` / `.github-resume-cache.json` / `config.json`
- GitHub token 通过 `gh auth token` 自动读取，不需要手动粘贴

---

## 完整文档

- [English docs](#english)
- [中文详细文档](#中文)

## License

MIT

---

## English

### What it does

Turn your last 3 years of merged GitHub PRs into a tailored tech resume in under 5 minutes. Paste a JD screenshot → local OCR → LLM reads your PRs → outputs `resume.md` + `resume.pdf` + `interview-prep.md` with predicted interview questions.

### Key differentiators

- **FAB-based writing** (Feature / Advantage / Benefit) — every project bullet ties back to value for the employer
- **Anti-hallucination** — quantified metrics must come from PR evidence; LLM won't fabricate "10M DAU"
- **Auto repo discovery** — no more typing org names; uses GitHub search API to find every repo you've shipped PRs to
- **Smart period mapping** — matches each PR's merge date to the right employer from your existing PDF resume
- **Provider-agnostic** — OpenAI / DeepSeek / OpenRouter / Volcano ARK / local Ollama all work
- **Local-first** — OCR runs locally via tesseract.js; JD screenshots never leave your machine

### Prerequisites

- Node.js 18+
- Any OpenAI-compatible LLM endpoint (first launch will prompt for `baseURL` / `apiKey` / `model`, saved to `~/.easy-offer/config.json` with mode 0600; re-run with `easy-offer config` to change; or set `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` env vars)
- GitHub Personal Access Token with `repo` scope (or just run `gh auth login` first — token is auto-detected)

### Install & Run

```bash
npx easy-offer
# or
npm install -g easy-offer && easy-offer
```

### Subcommands

```bash
easy-offer config     # Configure / reconfigure LLM
easy-offer fetch      # Step 1: fetch GitHub data → cache
easy-offer build      # Step 2: generate resume from cache
easy-offer interview  # Step 3: generate interview prep plan
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default: cwd) |
| `--no-pdf` | Skip PDF generation |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint base URL (overrides config.json) |
| `OPENAI_API_KEY` | API key (overrides config.json) |
| `OPENAI_MODEL` | Model name, e.g. `gpt-4o-mini`, `deepseek-chat` (overrides config.json) |
| `GITHUB_TOKEN` | GitHub token (auto-read from `gh auth token` if not set) |

### Output files

| File | Description |
|------|-------------|
| `resume.md` | Professional resume in Markdown |
| `resume.pdf` | PDF version |
| `interview-prep.md` | Interview prep with predicted questions, behavioral topics, reverse-questions |
| `.github-resume-cache.json` | GitHub data cache (re-run `build` without re-fetching) |

---

## 中文

### 一句话说明

**读你过去几年的所有 merged PR，用 AI 按岗位写出一份能直接投递的简历。**

### 核心差异点

- **FAB 写作框架**（Feature / Advantage / Benefit）：每段项目经历都明确三层"是什么 / 好在哪 / 对雇主何价值"
- **反幻觉**：量化数据必须有 PR 依据，LLM 不会瞎编"千万 DAU"
- **自动发现仓库**：不再需要手输组织名，用 GitHub 搜索 API 自动扫你所有参与过的项目（跨 org + 个人账号）
- **智能时段映射**：根据 PR 合并日期自动对应到 PDF 简历里的工作经历段
- **供应商无锁定**：OpenAI / DeepSeek / OpenRouter / 火山方舟 / 本地 Ollama 全支持
- **本地优先**：OCR 本地跑，JD 截图从不上传

### 环境要求

- Node.js 18+
- 任何 OpenAI 兼容接口（首次运行时引导你输入 `baseURL` / `apiKey` / `model`，保存到 `~/.easy-offer/config.json`，权限 0600；后续可用 `easy-offer config` 修改；也可设 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` 环境变量覆盖）
- GitHub Personal Access Token（需 `repo` 权限；若已 `gh auth login` 则自动读取无需手动粘贴）

### 安装运行

```bash
npx easy-offer
# 或全局安装
npm install -g easy-offer && easy-offer
```

### 子命令

```bash
easy-offer config     # 配置 / 修改 LLM（baseURL / apiKey / model）
easy-offer fetch      # 第一步：拉取 GitHub 数据并缓存
easy-offer build      # 第二步：从缓存生成简历
easy-offer interview  # 第三步：生成面试准备计划
```

### 参数选项

| 参数 | 说明 |
|------|------|
| `-o, --output <dir>` | 输出目录（默认当前目录） |
| `--no-pdf` | 跳过 PDF 生成 |

### 环境变量

| 变量 | 说明 |
|------|------|
| `OPENAI_BASE_URL` | OpenAI 兼容接口 base URL（覆盖 config.json） |
| `OPENAI_API_KEY` | API Key（覆盖 config.json） |
| `OPENAI_MODEL` | 模型名，如 `gpt-4o-mini` / `deepseek-chat`（覆盖 config.json） |
| `GITHUB_TOKEN` | GitHub Token（未设则自动从 `gh auth token` 读取） |

### 输出文件

| 文件 | 说明 |
|------|------|
| `resume.md` | Markdown 格式简历 |
| `resume.pdf` | PDF 简历 |
| `interview-prep.md` | 面试准备计划（必考题 / 追问预测 / 行为题 / 反向追问） |
| `.github-resume-cache.json` | GitHub 数据缓存（`build` / `interview` 可复用，无需重拉） |

### 调试工作流

调 prompt 效果时，不用每次都重新拉 GitHub：

```bash
easy-offer fetch       # 拉一次，存到 .github-resume-cache.json
easy-offer build       # 反复跑这条调简历 prompt
easy-offer interview   # 反复跑这条调面试 prompt
```

### 贡献

Issues & PRs welcome. 如果这个工具帮你拿到了 offer，欢迎 **star** 一下让更多工程师发现。
