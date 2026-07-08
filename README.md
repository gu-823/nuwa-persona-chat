# 女娲人格聊天 · nuwa-persona-chat

一个**多人格 AI 聊天**应用：用不同人物（思想家、投资人、创业者……）的口吻与思维框架对话，支持**联网检索**让人物引用当下资料，并内置**站点登录口令**防止 API 额度被盗用。

> 前端 React 19 + Vite 7，后端 Express 5 + TypeScript，单仓库同时跑 API 与构建后的前端。

---

## ✨ 功能特性

- **多人格切换**：内置多位人物人格（`Feynman`、`Jobs`、`Munger`、`Musk`、`Naval`、`Taleb`、`Trump`、张一鸣、张雪峰、王阳明……），可在对话中切换。
- **人格沉浸守卫**：后处理过滤第三人称 / 菜单式套话，保证回复始终"在角色里"。
- **联网检索**：对话时可自动（或手动强制）检索当下资料，并把来源附在回复里（`SEARCH_PROVIDER=doubao`，可选 `firecrawl`）。
- **人格蒸馏**：`/api/distill` 后台任务，从一个人物名 + 素材生成人格定义文件（Markdown）。
- **SSE 流式回复**：`/api/chats/:id/messages` 以 `text/event-stream` 逐字推送。
- **站点登录口令（session 鉴权）**：口令只在后端比对，登录后签发 `httpOnly` cookie；陌生人不知口令 → 拿不到 cookie → 无法调用任何 `/api`，从而**无法盗用 API 额度**。

---

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 · Vite 7 · TypeScript |
| 后端 | Express 5 · Node 22 · TypeScript（`tsx` 运行） |
| 实时 | Server-Sent Events（SSE） |
| 部署 | Docker 整站 / GitHub Pages 前端 + 独立后端 |

---

## 📁 目录结构

```
nuwa-persona-chat/
├── src/                  # 前端（React）
│   ├── App.tsx           # 主应用
│   ├── AuthGate.tsx      # 登录门（包住 App）
│   ├── LoginPage.tsx     # 站点登录口令页
│   ├── api.ts            # fetch 封装（credentials: include 自动带 cookie）
│   └── styles.css
├── server/               # 后端（Express）
│   ├── index.ts          # 入口：路由 + 静态托管 + 鉴权
│   ├── llm.ts            # 模型调用（LongCat）
│   ├── research.ts       # 联网检索（doubao / firecrawl）
│   ├── personas.ts       # 人格加载
│   ├── distill.ts        # 人格蒸馏
│   └── storage.ts        # 对话本地存档
├── *.md                  # 人格数据文件（被 server/personas.ts 引用）
├── Dockerfile
├── DEPLOY.md             # 详细部署说明
└── .env.example          # 环境变量模板
```

---

## 🚀 快速开始（本地开发）

### 1. 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少填入两个密钥：

| 变量 | 作用 | 必填 |
| --- | --- | --- |
| `LONGCAT_API_KEY` | 聊天模型（LongCat）密钥 | 聊天必填 |
| `DOUBAO_SEARCH_API_KEY` | 联网检索（豆包搜索）密钥 | 检索必填 |

其余变量见 [`.env.example`](.env.example)，一般保持默认即可。

### 2. 安装依赖 & 启动

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：

- **后端 API**：`http://0.0.0.0:8787`
- **前端**：`http://127.0.0.1:5173`（Vite 已把 `/api` 代理到后端）

打开 `http://127.0.0.1:5173`，输入**站点登录口令**即可进入。

> 本地默认口令为 `nuwa-dev-site-pass`（开发用）。
> 请通过环境变量 `NUWA_SITE_PASSWORD` 自定义；**公网部署务必改成只有你知道的长随机串**。

### 3. 常用脚本

```bash
npm run dev        # 前端 + 后端（热更新）
npm run build      # 仅构建前端到 dist/
npm run typecheck  # 前端 + 后端类型检查
npm run check:personas  # 校验人格数据文件
```

---

## 🔌 API 一览

所有 `/api` 接口（登录/登出/状态除外）都要求有效 session cookie，否则返回 `401`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/config` | 前端配置（模型/检索是否就绪） |
| GET | `/api/auth/status` | 查询当前登录态 |
| POST | `/api/login` | 站点登录（body: `{ password }`） |
| POST | `/api/logout` | 登出 |
| GET | `/api/personas` | 人格列表 |
| GET | `/api/personas/:id` | 单个人格详情 |
| POST | `/api/chats` | 新建/复用对话 |
| GET | `/api/chats` | 对话列表 |
| GET | `/api/chats/:id` | 对话详情 |
| POST | `/api/chats/:id/messages` | 发消息（**SSE 流式**） |
| POST | `/api/research` | 联网检索（body: `{ query }`） |
| POST | `/api/distill` | 人格蒸馏（后台任务） |
| GET | `/api/distill/:id` | 蒸馏任务状态 |

---

## 🐳 部署

> 完整说明见 [DEPLOY.md](DEPLOY.md)。

### 方案 A：Docker 整站（推荐，同源）

```bash
docker build -t nuwa .
docker run -d -p 8787:8787 \
  -e NUWA_SITE_PASSWORD="你的强口令" \
  -e LONGCAT_API_KEY="..." \
  -e DOUBAO_SEARCH_API_KEY="..." \
  nuwa
```

后端会同时托管前端（`dist/`）与 API，访问 `http://<服务器>:8787`。

### 方案 B：GitHub Pages 前端 + 独立后端（跨域）

- 前端：推送 `main` 自动由 `.github/workflows/deploy.yml` 部署到 Pages（需仓库 **Settings → Pages → Source 选 "GitHub Actions"**）；构建前设置仓库变量 `VITE_API_BASE` 指向你的后端域名。
- 后端：部署在任意常驻平台，启动时设置 `CORS_ORIGIN` 为 Pages 前端域名（如 `https://gu-823.github.io`），并配好 `NUWA_SITE_PASSWORD` 与 API 密钥。

> ⚠️ **务必用 HTTPS**：登录 cookie 在生产环境为 `Secure`，纯 http 下浏览器不会存储，导致无法登录。

---

## 🔐 安全说明

- **站点登录口令**是防盗用的第一道防线：口令只在后端比对（不进前端源码），并采用恒定时间比较防时序攻击。
- **密钥从不进仓库**：`.env` 已被 `.gitignore` 忽略，API 密钥只存在于服务端环境变量。
- 部署到公网请：
  1. 设置强随机 `NUWA_SITE_PASSWORD`；
  2. 使用 HTTPS；
  3. 可选：加 IP 级 rate-limit 防口令爆破。

---

## 📄 许可证

[MIT](LICENSE) © 2026 gu-823
