# Easy Offer Web

## 架构与成本

手机/桌面网页使用 Vite 构建为静态资源，Cloudflare Workers 直接提供这些资源。仅 `/api/*` 进入 Worker；不启用每次静态请求都执行 Worker 的模式。模型请求由 Worker 转发，GitHub 素材由浏览器直接请求 GitHub API。没有数据库、账号登录或云端同步。

使用 Workers 免费套餐即可开始；各项目共享账号额度。模型费用不包含在 Cloudflare 免费额度内：每位使用者填写自己的供应商 API Key，由供应商计费。无需配置 `OPENAI_API_KEY`、`GITHUB_TOKEN` 或任何共享凭证到 Cloudflare，也不要把它们加入 Vite 环境变量。

## 本地验证

需要 Node.js 22+。只开发网页版时，跳过 CLI 专用的 Chromium 下载：

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm test
npm run build
npm run check:web
npm run build:web
npx wrangler deploy --dry-run
npm run dev:api
```

默认预览地址 `http://localhost:8787`。热更新另开终端执行 `npm run dev:web`，访问 `http://127.0.0.1:5173`。Vite 把 `/api` 代理给本地 Wrangler，保留 Host 以进行同源检查。

## 发布到 Cloudflare

已有个人 Cloudflare 账号中创建名为 `easy-offer` 的 Worker，绑定此仓库：

- 构建命令：`npm run check:web && npm run build:web`
- 部署命令：`npx wrangler deploy`
- 环境变量：`PUPPETEER_SKIP_DOWNLOAD=1`、`NODE_VERSION=22`
- 根目录：仓库根目录
- 生产分支：`main`

这两项构建变量不是密钥。Cloudflare Git 构建所需的部署令牌与使用者的模型 Key 是两回事。先确认使用个人账号，再授权仓库和部署权限。使用平台默认的免费 `workers.dev` 地址即可；域名不是上线前提。

也可在个人账号完成 `npx wrangler login` 后执行 `npm run deploy:web`。配置文件没有账号 ID，发布前必须用 `npx wrangler whoami` 核对目标账号。不要使用临时预览账号冒充正式部署。

## 数据边界

- 模型 Key、GitHub Token 只保留在当前网页的内存中；不写入 URL、草稿或应用日志。
- 模型调用会把所填 Key、简历素材经 Cloudflare 发送给选中的模型供应商。Worker 仅处理该请求，不持久化，也不记录请求正文。
- GitHub Token 仅从浏览器发往 `api.github.com`。选择私有仓库素材前，应确认本人有权把相应材料发给模型供应商。
- 浏览器草稿包含个人资料、PR 内容和生成结果。只在自己的设备启用保存；清空草稿会删除本地保存内容，不会清除外部模型供应商的记录。
- 模型支持固定供应商地址，不接受任意代理 URL，避免把公开 Worker 变成通用转发器。
- Markdown 展示经过消毒，禁用远程图片等可发出额外网络请求的内容；导入 JSON 经过结构和大小检查。
- GitHub 导入为有限采样，界面提示缺失/截断情况。生成只使用所选素材，不读取仓库完整源码或代码差异。
- 模型输出需要本人核对，不能承诺事实绝对准确。没有证据的成果数字和职责不会被要求自动补齐。

## 上线检查

1. 首页在手机宽度下无横向溢出，四步流程和主要按钮可操作。
2. 示例内容明确为演示；不填 Key 不会发起模型调用。
3. 使用自己的供应商 Key 做一次真实生成，核对简历、面试准备、错误提示和下载。测试会产生供应商 API 费用。
4. 刷新后 Key/Token 为空；草稿开关符合用户选择。
5. `/api/health` 返回成功，非法来源/路径/输入被拒绝；上游错误不回显 Key。
6. 用大陆手机流量另行测试网络可达性。Cloudflare 免费地址、付费套餐或自定义域名都不能单凭配置保证大陆连接稳定。

单元测试使用虚构 Key 与模拟上游，不会花费真实模型额度。测试通过、代码推送、Cloudflare 部署成功、真实 AI 调用成功是不同层次，交付时分别报告。
