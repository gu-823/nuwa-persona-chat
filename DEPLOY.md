# 女娲人格聊天 (nuwa-persona-chat) 部署说明

一个 React + Vite 前端 + Express 常驻后端的人格对话应用。本文档说明如何把它真正上线。

## 项目结构
- 前端：React 19 + Vite 7，`npm run build` 产物在 `dist/`
- 后端：Express 5，监听端口 `8787`，提供流式对话 / 研究 / 人格蒸馏等 `/api/*` 接口
- 外部依赖（需密钥）：`LONGCAT_API_KEY`（大模型）、`DOUBAO_SEARCH_API_KEY`（联网搜索）

## 已修复的上线阻碍
修改前项目“能本地跑但不能直接上线”，以下问题已修复：
1. 后端原来硬编码监听 `127.0.0.1`，上线后外部无法访问 → 已改为 `0.0.0.0`（可用 `HOST` 环境变量覆盖）。见 `server/index.ts`。
2. 后端不托管前端静态资源（dev 靠 Vite proxy）→ 现已在 `dist/` 存在时自动用手写 `fs + sendFile` 中间件托管并加 SPA fallback（规避 Windows 中文路径下 `express.static` 静默 404 的坑），**一个进程即可同时提供前端 + API**（Docker 方案）。
3. 前端所有请求走相对路径 `/api/...`，纯静态托管（如 GitHub Pages）无法反代 → 前端已支持 `VITE_API_BASE` 环境变量，可指向独立后端域名。见 `src/api.ts` 与 `src/vite-env.d.ts`。
4. 新增 `Dockerfile`、`.dockerignore`、GitHub Pages 自动部署工作流。

> 注意：`.env` 已被 `.gitignore` 忽略，密钥不会进仓库；Docker/CI 也不会把 `.env` 打进镜像，请通过平台的环境变量 / Secrets 注入。

---

## 方案 A：Docker 整站部署（前后端一起，推荐）

最省事，一个容器同时跑前端和后端，对话 / 研究 / 蒸馏全部可用。适合任意支持容器的平台（云服务器、Railway、Render、Fly.io、腾讯云 CloudBase 云托管等）。

```bash
# 1. 构建镜像
docker build -t nuwa-persona-chat .

# 2. 运行（密钥通过环境变量注入，不要写进镜像）
docker run -d --name nuwa \
  -p 8787:8787 \
  -e LONGCAT_API_KEY=你的key \
  -e DOUBAO_SEARCH_API_KEY=你的key \
  -e LONGCAT_BASE_URL=https://api.longcat.chat/openai/v1 \
  -e LONGCAT_MODEL=LongCat-2.0 \
  -e SEARCH_PROVIDER=doubao \
  -e DOUBAO_SEARCH_API_URL=https://open.feedcoopapi.com/search_api/web_search \
  -e PORT=8787 \
  -e NUWA_SITE_PASSWORD=你的站点口令 \
  nuwa-persona-chat
```

容器启动后，浏览器访问 `http://<服务器IP>:8787` 即可。平台部署时把上面的环境变量填到对应配置里即可。

---

## 方案 B：GitHub Pages 前端 + 独立后端

GitHub 本身**不能跑常驻后端**，但可以用组合：
- **前端**：GitHub Pages（免费、自动 CI）上线静态页
- **后端**：GitHub 做代码仓库，部署到能跑 Docker 的平台（Railway / Render / Fly.io / 云服务器）

### 步骤
1. 在仓库 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**。
2. 在仓库 **Settings → Secrets and variables → Actions → Variables** 添加 `VITE_API_BASE`，值为你后端上线后的地址，例如 `https://nuwa-api.example.com`（末尾不要带 `/`）。留空则前端走同源 `/api`，此时对话功能需后端在同一域名（通常不满足）。
3. 把代码推到 `main` 分支，工作流 `.github/workflows/deploy.yml` 会自动构建并发布前端到 GitHub Pages。
4. 后端按“方案 A”部署到某容器平台，并配置：
   - `LONGCAT_API_KEY` / `DOUBAO_SEARCH_API_KEY` 等密钥；
   - `NUWA_SITE_PASSWORD`：设成只有你知道的站点口令（否则任何人都能登录）；
   - `CORS_ORIGIN`：填你的 GitHub Pages 地址（如 `https://你的用户名.github.io`），允许跨域携带登录 cookie。

> GitHub Pages 是纯静态托管，没有 `/api` 反代能力，因此**必须**通过 `VITE_API_BASE` 把前端指向独立后端，否则对话 / 研究功能不可用。

---

## 环境变量清单

| 变量 | 说明 | 必填 |
| --- | --- | --- |
| `PORT` | 后端监听端口，默认 `8787` | 否 |
| `HOST` | 监听地址，默认 `0.0.0.0` | 否 |
| `LONGCAT_API_KEY` | 大模型 API Key | 是（否则对话不可用） |
| `LONGCAT_BASE_URL` | 大模型接口地址 | 否（有默认值） |
| `LONGCAT_MODEL` | 模型名 | 否（有默认值） |
| `SEARCH_PROVIDER` | 联网搜索提供商，如 `doubao` | 否 |
| `DOUBAO_SEARCH_API_KEY` | 联网搜索 Key | 否（否则研究功能不可用） |
| `DOUBAO_SEARCH_API_URL` | 联网搜索接口地址 | 否 |
| `VITE_API_BASE` | 前端指向的后端地址（仅构建时生效） | 否 |
| `NUWA_SITE_PASSWORD` | 站点登录口令，后端校验；缺省 `nuwa-dev-site-pass`，**公网部署必改** | 否（公网部署必改） |
| `CORS_ORIGIN` | 跨域部署时前端源（如 `https://xxx.github.io`），用于后端 CORS；同源 / Docker 整站留空 | 否 |

---

## 安全提醒（上线前务必看）
- **密钥不要进仓库 / 镜像**：通过平台 Secrets / 环境变量注入。
- **站点登录口令（已内置，推荐）**：网页打开后需先输入站点口令，后端校验通过才签发 httpOnly session cookie；之后所有 `/api` 接口都要求有效 session，没口令的人**完全无法调用**。前端源码里不包含任何可调用的凭证，陌生人即使扒前端也拿不到能用的令牌——这已做到"陌生人绝对无法盗用"。
  - **口令保密是关键**：内置默认值 `nuwa-dev-site-pass` 仅用于本地 / Docker 开箱即用，**公网部署务必通过 `NUWA_SITE_PASSWORD` 改成只有你知道的长随机串**。一旦口令泄露给某人，那人就能登录使用；所以这是"知道口令的人能用"，不是无差别开放。
  - **登录态存在后端内存**：服务重启后所有登录态失效（个人项目足够；如需持久化可后续接入存储）。
  - 若仍需更严格（如防同一口令被多人共享刷额度），可再加 `express-rate-limit` 速率限制。
- 聊天记录写入 `data/chats/`，多用户公网部署时需注意隔离与存储清理。

---

## 本地预览生产效果
```bash
npm run build
cp .env .env.local   # 确保有密钥
npx tsx server/index.ts   # 访问 http://localhost:8787
```
