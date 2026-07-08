import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { distillPersona, type DistillDepth } from "./distill.js";

// Resolve the built frontend relative to the process working directory
// (the project root). This is reliable under tsx, plain node, and Docker,
// unlike import.meta.url which tsx rewrites to a temp transpile path.
const distDir = path.resolve(process.cwd(), "dist");
console.log(`[nuwa] frontend dist: ${distDir} (exists: ${fs.existsSync(distDir)})`);
import { getModelName, isChatConfigured, streamChat } from "./llm.js";
import { getPersona, loadPersonas } from "./personas.js";
import { buildMessagesForPersona, sanitizePersonaReply, shouldExitRole } from "./prompts.js";
import { getResearchProvider, isResearchConfigured, needsFreshContext, runResearch } from "./research.js";
import { createChat, ensureRuntimeDirs, getLatestChatForPersona, listChats, readChat, saveChat } from "./storage.js";
import type { ChatMessage, ClientConfig, ResearchResult } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 8787);

interface DistillJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
  personName: string;
  depth: DistillDepth;
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: {
    id: string;
    filePath: string;
    depth: DistillDepth;
    researchFiles?: string[];
    qualityReportPath?: string;
  };
  error?: string;
}

const distillJobs = new Map<string, DistillJob>();

// CORS：仅当跨域部署（如 GitHub Pages 前端 + 独立后端）时才设置。
// 同源 / Docker 整站部署不需要，留空即可。配合前端 fetch 的
// credentials: "include" 与下方 session cookie 的 SameSite=None;Secure 使用。
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: "2mb" }));

// 站点登录口令（session 鉴权）
// 口令只在后端比对，不进前端源码；登录成功后签发 httpOnly session cookie，
// 所有 /api 接口（登录 / 登出 / 状态除外）都要求有效 session，否则 401。
// 陌生人不知口令 → 拿不到 cookie → 无法调用任何接口（接近"绝对防盗用"）。
// 注意：口令保密是关键——一旦泄露给某人，那人就能登录；所以公网部署务必把
// NUWA_SITE_PASSWORD 设成只有你知道的长随机串。
const SITE_PASSWORD = process.env.NUWA_SITE_PASSWORD || "nuwa-dev-site-pass";
const SESSION_COOKIE = "nuwa_session";
const sessions = new Set<string>();

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res: express.Response, req: express.Request, id: string): void {
  // 生产（HTTPS）下用 SameSite=None;Secure 以便跨站（如 GitHub Pages）携带；
  // 本地开发（http）用 SameSite=Lax，避免 Secure cookie 无法存储。
  const isProd = process.env.NODE_ENV === "production" || req.secure;
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

function clearSessionCookie(res: express.Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

// 恒定时间比较，避免口令比对被时序攻击推断。
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// 这些接口不需要已登录：登录/登出/查询登录态本身。
const PUBLIC_API = new Set(["/api/login", "/api/logout", "/api/auth/status"]);

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  if (PUBLIC_API.has(req.path)) return next();
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sid && sessions.has(sid)) return next();
  res.status(401).json({ error: "Unauthorized." });
});

app.get("/api/auth/status", (req, res) => {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  res.json({ authenticated: Boolean(sid && sessions.has(sid)) });
});

app.post("/api/login", (req, res) => {
  const password = String(req.body?.password || "");
  if (!safeEqual(password, SITE_PASSWORD)) {
    return res.status(401).json({ error: "口令错误。" });
  }
  const sid = crypto.randomUUID();
  sessions.add(sid);
  setSessionCookie(res, req, sid);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sid) sessions.delete(sid);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  const config: ClientConfig = {
    chatConfigured: isChatConfigured(),
    researchConfigured: isResearchConfigured(),
    researchProvider: getResearchProvider(),
    model: getModelName()
  };
  res.json(config);
});

app.get("/api/personas", async (_req, res, next) => {
  try {
    const personas = await loadPersonas();
    res.json(personas.map(({ markdown, ...persona }) => persona));
  } catch (error) {
    next(error);
  }
});

app.get("/api/personas/:id", async (req, res, next) => {
  try {
    const persona = await getPersona(req.params.id);
    if (!persona) return res.status(404).json({ error: "Persona not found." });
    res.json(persona);
  } catch (error) {
    next(error);
  }
});

app.post("/api/chats", async (req, res, next) => {
  try {
    const personaId = String(req.body?.personaId || "");
    const reuseLatest = Boolean(req.body?.reuseLatest);
    const persona = await getPersona(personaId);
    if (!persona) return res.status(404).json({ error: "Persona not found." });
    if (reuseLatest) {
      const latest = await getLatestChatForPersona(persona.id);
      if (latest) return res.json(latest);
    }
    const chat = await createChat(persona.id);
    res.json(chat);
  } catch (error) {
    next(error);
  }
});

app.get("/api/chats", async (req, res, next) => {
  try {
    const personaId = typeof req.query.personaId === "string" ? req.query.personaId : undefined;
    const chats = await listChats(personaId);
    res.json(chats);
  } catch (error) {
    next(error);
  }
});

app.get("/api/chats/:id", async (req, res, next) => {
  try {
    const chat = await readChat(req.params.id);
    if (!chat) return res.status(404).json({ error: "Chat not found." });
    res.json(chat);
  } catch (error) {
    next(error);
  }
});

app.post("/api/research", async (req, res, next) => {
  try {
    const query = String(req.body?.query || "").trim();
    if (!query) return res.status(400).json({ error: "query is required." });
    const result = await runResearch(query);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/distill", async (req, res, next) => {
  try {
    const personName = String(req.body?.personName || "").trim();
    if (!personName) return res.status(400).json({ error: "personName is required." });

    const depth: DistillDepth = req.body?.depth === "quick" ? "quick" : "standard";
    const now = new Date().toISOString();
    const job: DistillJob = {
      id: crypto.randomUUID(),
      status: "queued",
      personName,
      depth,
      message: "已加入后台蒸馏队列。",
      createdAt: now,
      updatedAt: now
    };
    distillJobs.set(job.id, job);
    res.status(202).json(publicDistillJob(job));

    void runDistillJob(job.id, {
      personName,
      purpose: String(req.body?.purpose || ""),
      materials: String(req.body?.materials || ""),
      depth
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/distill/:id", (req, res) => {
  const job = distillJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Distill job not found." });
  res.json(publicDistillJob(job));
});

app.post("/api/chats/:id/messages", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const chat = await readChat(req.params.id);
    if (!chat) {
      send({ type: "error", message: "Chat not found." });
      return res.end();
    }

    const persona = await getPersona(chat.personaId);
    if (!persona) {
      send({ type: "error", message: "Persona not found." });
      return res.end();
    }

    const content = String(req.body?.content || "").trim();
    const forceResearch = Boolean(req.body?.forceResearch);
    if (!content) {
      send({ type: "error", message: "Message content is required." });
      return res.end();
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };
    chat.messages.push(userMessage);

    if (shouldExitRole(content)) {
      chat.mode = "normal";
    }

    let research: ResearchResult | undefined;
    if ((forceResearch || needsFreshContext(content)) && isResearchConfigured()) {
      send({ type: "status", message: "正在查当下资料..." });
      try {
        research = await runResearch(content);
        send({ type: "sources", sources: research.sources });
      } catch (error) {
        send({ type: "research-error", message: error instanceof Error ? error.message : "Research failed." });
      }
    }

    if (!isChatConfigured()) {
      await saveChat(chat);
      send({
        type: "error",
        message: "LONGCAT_API_KEY is not configured. Add it to .env to enable live chat."
      });
      return res.end();
    }

    const firstPersonaReply = chat.mode === "persona" && !chat.messages.some((message) => message.role === "assistant");
    const modelMessages = buildMessagesForPersona(persona, chat.messages, {
      mode: chat.mode,
      firstPersonaReply,
      research
    });

    send({ type: "status", message: "正在唤醒思维框架..." });
    const rawAnswer = await streamChat(modelMessages, () => {
      // Hold model text until it passes the immersion guard, so known broken
      // third-person/menu phrasing never flashes in the live chat.
    });
    const answer = sanitizePersonaReply(persona, rawAnswer, { firstPersonaReply });
    send({ type: "delta", delta: answer });

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: answer,
      createdAt: new Date().toISOString(),
      sources: research?.sources
    };
    chat.messages.push(assistantMessage);
    await saveChat(chat);

    send({ type: "done", message: assistantMessage });
    res.end();
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "Unexpected server error." });
    res.end();
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(500).json({ error: message });
});

const host = process.env.HOST || "0.0.0.0";

await ensureRuntimeDirs();

// Serve the built frontend when dist/ exists (production / Docker).
// In dev the frontend is served by Vite, so this block is a no-op there.
// Serve the built frontend. We deliberately avoid express.static here because
// its internal path handling misbehaves on Windows when the project lives in a
// path with non-ASCII characters (e.g. a Chinese folder name). Using fs +
// sendFile is robust across platforms and handles SPA fallback in one place.
if (fs.existsSync(distDir)) {
  const indexHtml = path.resolve(distDir, "index.html");
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    const target = path.resolve(distDir, "." + req.path);
    if (path.relative(distDir, target).startsWith("..")) return next();
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return res.sendFile(target);
    }
    return res.sendFile(indexHtml);
  });
}

app.listen(port, host, () => {
  console.log(`Nuwa persona API listening at http://${host}:${port}`);
});

async function runDistillJob(
  jobId: string,
  input: { personName: string; purpose: string; materials: string; depth: DistillDepth }
): Promise<void> {
  updateDistillJob(jobId, {
    status: "running",
    message: input.depth === "standard" ? "标准女娲蒸馏已启动。" : "快速预览蒸馏已启动。"
  });

  try {
    const result = await distillPersona(input, (message) => {
      updateDistillJob(jobId, { status: "running", message });
    });
    updateDistillJob(jobId, {
      status: "done",
      message: `${result.id} 已完成并加入人物库。`,
      result
    });
  } catch (error) {
    updateDistillJob(jobId, {
      status: "error",
      message: "后台蒸馏失败。",
      error: error instanceof Error ? error.message : "Distill failed."
    });
  }
}

function updateDistillJob(jobId: string, patch: Partial<DistillJob>): void {
  const current = distillJobs.get(jobId);
  if (!current) return;
  distillJobs.set(jobId, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

function publicDistillJob(job: DistillJob): DistillJob {
  return { ...job };
}
