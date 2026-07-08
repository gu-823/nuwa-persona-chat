# 安全政策 · Security Policy

## 报告漏洞

如果你发现安全漏洞（包括但不限于鉴权绕过、API 额度盗用、密钥泄露风险），请**不要**公开提 Issue。

请通过 GitHub 的 **Security → Report a vulnerability**（私有安全公告）提交，或直接联系仓库维护者。我们会尽快处理。

## 默认凭证提醒

本项目带一个**开发用默认站点登录口令** `nuwa-dev-site-pass`。它**仅用于本地开发**，公网部署前必须：

1. 通过环境变量 `NUWA_SITE_PASSWORD` 设置为只有你知道的**长随机串**；
2. 全程使用 **HTTPS**（登录 cookie 在生产环境为 `Secure`，纯 http 下浏览器不会存储）。

## 密钥管理

- 所有密钥（如 `LONGCAT_API_KEY`、`DOUBAO_SEARCH_API_KEY`）只应存在于服务端环境变量或 `.env`，**绝不要提交进仓库**（`.env` 已被 `.gitignore` 忽略）。
- 前端构建产物中**不含任何密钥**，鉴权依赖后端 session cookie。

## 鉴权机制

- 站点登录口令只在后端比对，并使用恒定时间比较（`crypto.timingSafeEqual`）防时序攻击。
- 登录成功后签发 `httpOnly` session cookie；除登录/登出/状态接口外，所有 `/api` 都要求有效 session，否则返回 `401`。
- session 存于内存，进程重启即失效（如需持久化可后续接入外部存储）。
