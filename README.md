# easy-offer

> [English](#english) | [中文](#中文)

---

## English

Generate a tailored resume from your GitHub commit history using any OpenAI-compatible LLM.

### Features

- Parses existing PDF resume to extract work history
- Fetches your GitHub PRs interactively
- Uses an LLM to generate professional resume descriptions (problem-solution-result format)
- Tailors resume to a specific JD if provided
- Supports JD input via screenshot (local OCR via tesseract.js, with editor-based proofreading) or manual text paste
- Outputs `resume.md` + `resume.pdf`
- Generates `interview-prep.md` with predicted interview questions

### Prerequisites

- Node.js 18+
- LLM access via any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Ollama, etc.). On first run, the CLI prompts for `baseURL`, `apiKey`, and `model`, and saves them to `~/.easy-offer/config.json` (mode 0600). Re-run with `easy-offer config` to change. Or set `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` env vars to override individual fields.
- GitHub Personal Access Token (with `repo` scope)

### Usage

```bash
npx easy-offer
```

Or install globally:
```bash
npm install -g easy-offer
easy-offer
```

#### Subcommands

```bash
easy-offer config    # Configure / reconfigure LLM (baseURL / apiKey / model)
easy-offer fetch     # Step 1: fetch GitHub data → cache
easy-offer build     # Step 2: generate resume from cache
easy-offer interview # Step 3: generate interview prep plan
```

#### Options

| Flag | Description |
|------|-------------|
| `-o, --output <dir>` | Output directory (default: current dir) |
| `--no-pdf` | Skip PDF generation (build command) |

#### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint base URL (optional, will prompt on first run) |
| `OPENAI_API_KEY` | API key for the endpoint (optional, will prompt on first run) |
| `OPENAI_MODEL` | Model name (e.g., `gpt-4o`, `deepseek-chat`) (optional, will prompt on first run) |
| `GITHUB_TOKEN` | GitHub token (optional, can be entered interactively) |

### How it works

1. **Step 0** (optional): Enter your target job position and provide the JD — either as a screenshot (local OCR via tesseract.js; the extracted text opens in your `$EDITOR` for proofreading) or by pasting text. First OCR run downloads a ~15MB Chinese language pack to `~/.easy-offer/tesseract-cache/`.
2. **Step 1**: Select your target role type (Go backend, Node.js, AI/Agent, etc.)
3. **Step 2**: Provide your existing PDF resume path to extract work history
4. **Step 3**: Authenticate with GitHub and select repos to include
5. **Step 4**: The LLM analyzes each repo's PR history and generates professional resume sections
6. **Step 5** (optional): Generate an interview prep plan with predicted questions

### Output files

| File | Description |
|------|-------------|
| `resume.md` | Professional resume in Markdown |
| `resume.pdf` | PDF version of the resume |
| `interview-prep.md` | Interview prep plan with predicted questions |
| `.github-resume-cache.json` | Cached GitHub data (re-run `build` without re-fetching) |

### License

MIT

---

## 中文

基于你的 GitHub commit 历史，用任意 OpenAI 兼容大模型自动生成定制化简历。

### 功能特性

- 解析现有 PDF 简历，提取工作经历
- 交互式拉取你的 GitHub PR 数据
- 用大模型生成专业简历描述（问题-方案-结果格式）
- 支持针对特定 JD 定制简历内容
- JD 输入支持截图（本地 OCR，基于 tesseract.js，识别后在编辑器中二次校对）或手动粘贴文字
- 输出 `resume.md` + `resume.pdf`
- 生成 `interview-prep.md` 面试准备计划

### 环境要求

- Node.js 18+
- 任何 OpenAI 兼容接口（OpenAI、DeepSeek、OpenRouter、本地 Ollama 等）。首次运行时 CLI 会引导你输入 `baseURL` / `apiKey` / `model`，存到 `~/.easy-offer/config.json`（权限 0600）。后续修改运行 `easy-offer config`。也可设置环境变量 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` 覆盖单个字段。
- GitHub Personal Access Token（需要 `repo` 权限）

### 使用方法

```bash
npx easy-offer
```

或全局安装：
```bash
npm install -g easy-offer
easy-offer
```

#### 子命令

```bash
easy-offer config    # 配置/修改 LLM（baseURL / apiKey / model）
easy-offer fetch     # 第一步：拉取 GitHub 数据并缓存
easy-offer build     # 第二步：从缓存生成简历
easy-offer interview # 第三步：生成面试准备计划
```

#### 参数选项

| 参数 | 说明 |
|------|------|
| `-o, --output <dir>` | 输出目录（默认为当前目录） |
| `--no-pdf` | 跳过 PDF 生成（build 命令） |

#### 环境变量

| 变量 | 说明 |
|------|------|
| `OPENAI_BASE_URL` | OpenAI 兼容接口的基础 URL（可选，首次运行时会提示输入） |
| `OPENAI_API_KEY` | 接口的 API Key（可选，首次运行时会提示输入） |
| `OPENAI_MODEL` | 模型名称，如 `gpt-4o`、`deepseek-chat`（可选，首次运行时会提示输入） |
| `GITHUB_TOKEN` | GitHub Token（可选，可在交互中输入） |

### 使用流程

1. **第 0 步**（可选）：输入目标岗位名称，提供 JD —— 可上传截图（本地 OCR 识别，基于 tesseract.js，识别后会在 `$EDITOR` 中打开供你二次校对）或手动粘贴文字。首次识别会下载约 15MB 的中文语言包到 `~/.easy-offer/tesseract-cache/`。
2. **第 1 步**：选择目标工种（Go 后端、Node.js、AI/Agent 等）
3. **第 2 步**：提供现有 PDF 简历路径，提取工作经历
4. **第 3 步**：GitHub 授权，选择要纳入简历的仓库
5. **第 4 步**：大模型分析各仓库的 PR 历史，生成专业简历内容
6. **第 5 步**（可选）：生成面试准备计划，包含预测面试题

### 输出文件

| 文件 | 说明 |
|------|------|
| `resume.md` | Markdown 格式的专业简历 |
| `resume.pdf` | PDF 版简历 |
| `interview-prep.md` | 面试准备计划及预测问题 |
| `.github-resume-cache.json` | GitHub 数据缓存（可复用，无需重复拉取） |

### 许可证

MIT
