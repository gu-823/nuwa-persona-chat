# 贡献指南 · Contributing

欢迎提 Issue 和 PR！以下是本地参与开发的最小约定。

## 环境要求

- Node 22+
- 一个 `LONGCAT_API_KEY`（聊天）和 `DOUBAO_SEARCH_API_KEY`（联网检索），填入 `.env`

## 本地开发

```bash
cp .env.example .env   # 填入密钥
npm install
npm run dev            # 前端 http://127.0.0.1:5173 + 后端 :8787
```

登录口令默认 `nuwa-dev-site-pass`，可用 `NUWA_SITE_PASSWORD` 覆盖。

## 提交流程

1. Fork 并拉取你的分支。
2. 保持改动聚焦；前端在 `src/`，后端在 `server/`。
3. 提交前请跑：`npm run typecheck`（前后端类型检查）与 `npm run build`（前端构建）。
4. 在 GitHub 发起 PR，描述改动目的。

## 代码风格

- TypeScript 全量类型，避免 `any`。
- 后端接口请遵循现有 `/api/*` 约定；新增需要鉴权的接口会自动被 session 中间件保护（登录/登出/状态除外）。
- 不要提交 `.env`、密钥、`node_modules/`、`dist/`——这些都已在 `.gitignore` 中。

## 目录说明

- `nuwa-skill-main/` 是一个**独立子项目**（人格蒸馏技能），不属于本应用，已被 `.gitignore` 排除，请勿在本仓库提交它。
