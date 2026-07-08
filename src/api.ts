import type { ChatSession, ChatSummary, ClientConfig, DistillJob, Persona, ResearchSource, StreamEvent } from "./types";

// In production the frontend may be served from a different origin than the
// API (e.g. GitHub Pages + a separately hosted backend). VITE_API_BASE lets us
// point the SPA at the backend. Leave empty for same-origin (Docker / dev).
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

// 登录态由后端签发的 httpOnly session cookie 携带（见 src/AuthGate.tsx）。
// 所有请求都带 credentials: "include"，使同源(Docker/dev)与跨域(GitHub Pages)
// 部署下的 cookie 都能自动随请求发送；前端源码里不包含任何可调用的凭证。

export async function getAuthStatus(): Promise<{ authenticated: boolean }> {
  return getJson<{ authenticated: boolean }>("/api/auth/status");
}

export async function login(password: string): Promise<void> {
  await postJson<{ ok: boolean }>("/api/login", { password });
}

export async function logout(): Promise<void> {
  await postJson<{ ok: boolean }>("/api/logout", {});
}

export async function getConfig(): Promise<ClientConfig> {
  return getJson<ClientConfig>("/api/config");
}

export async function getPersonas(): Promise<Persona[]> {
  return getJson<Persona[]>("/api/personas");
}

export async function createChat(personaId: string, reuseLatest = false): Promise<ChatSession> {
  return postJson<ChatSession>("/api/chats", { personaId, reuseLatest });
}

export async function getChat(chatId: string): Promise<ChatSession> {
  return getJson<ChatSession>(`/api/chats/${encodeURIComponent(chatId)}`);
}

export async function getChatHistory(personaId: string): Promise<ChatSummary[]> {
  return getJson<ChatSummary[]>(`/api/chats?personaId=${encodeURIComponent(personaId)}`);
}

export async function runResearch(query: string): Promise<{ sources: ResearchSource[] }> {
  return postJson<{ sources: ResearchSource[] }>("/api/research", { query });
}

export async function distillPersona(payload: {
  personName: string;
  purpose: string;
  materials: string;
  depth: "standard" | "quick";
}): Promise<DistillJob> {
  return postJson<DistillJob>("/api/distill", payload);
}

export async function getDistillJob(jobId: string): Promise<DistillJob> {
  return getJson<DistillJob>(`/api/distill/${encodeURIComponent(jobId)}`);
}

export async function sendMessageStream(
  chatId: string,
  payload: { content: string; forceResearch: boolean },
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Message request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const line = event.split(/\r?\n/).find((item) => item.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(API_BASE + url, {
    credentials: "include"
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(API_BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `${url} failed: ${response.status}`);
  return json as T;
}
