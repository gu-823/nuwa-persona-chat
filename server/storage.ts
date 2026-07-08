import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CHATS_DIR, CUSTOM_PERSONAS_DIR, DATA_DIR, RESEARCH_DIR } from "./paths.js";
import type { ChatSession, ChatSummary, ResearchResult } from "./types.js";

export async function ensureRuntimeDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(CHATS_DIR, { recursive: true }),
    fs.mkdir(RESEARCH_DIR, { recursive: true }),
    fs.mkdir(CUSTOM_PERSONAS_DIR, { recursive: true })
  ]);
}

export async function createChat(personaId: string): Promise<ChatSession> {
  const now = new Date().toISOString();
  const chat: ChatSession = {
    id: crypto.randomUUID(),
    personaId,
    mode: "persona",
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  await saveChat(chat);
  return chat;
}

export async function getLatestChatForPersona(personaId: string): Promise<ChatSession | undefined> {
  const summaries = await listChats(personaId);
  const latest = summaries[0];
  return latest ? readChat(latest.id) : undefined;
}

export async function listChats(personaId?: string): Promise<ChatSummary[]> {
  await fs.mkdir(CHATS_DIR, { recursive: true });
  const entries = await fs.readdir(CHATS_DIR, { withFileTypes: true });
  const chats: ChatSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(CHATS_DIR, entry.name), "utf8");
      const chat = JSON.parse(raw) as ChatSession;
      if (personaId && chat.personaId !== personaId) continue;
      const lastMessage = [...chat.messages].reverse().find((message) => message.content.trim());
      chats.push({
        id: chat.id,
        personaId: chat.personaId,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messageCount: chat.messages.length,
        preview: lastMessage?.content.slice(0, 90) || "新对话"
      });
    } catch {
      // Ignore malformed chat files; one bad history item should not break the app.
    }
  }

  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readChat(chatId: string): Promise<ChatSession | undefined> {
  try {
    const raw = await fs.readFile(path.join(CHATS_DIR, `${safeFileId(chatId)}.json`), "utf8");
    return JSON.parse(raw) as ChatSession;
  } catch {
    return undefined;
  }
}

export async function saveChat(chat: ChatSession): Promise<void> {
  chat.updatedAt = new Date().toISOString();
  await fs.mkdir(CHATS_DIR, { recursive: true });
  await fs.writeFile(path.join(CHATS_DIR, `${safeFileId(chat.id)}.json`), JSON.stringify(chat, null, 2), "utf8");
}

export async function saveResearch(result: ResearchResult): Promise<void> {
  await fs.mkdir(RESEARCH_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RESEARCH_DIR, `${safeFileId(result.id)}.json`),
    JSON.stringify(result, null, 2),
    "utf8"
  );
}

export async function saveCustomPersona(slug: string, markdown: string): Promise<string> {
  const safeSlug = safeFileId(slug);
  const targetDir = path.join(CUSTOM_PERSONAS_DIR, safeSlug);
  await fs.mkdir(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, "SKILL.md");
  await fs.writeFile(targetFile, markdown, "utf8");
  return targetFile;
}

function safeFileId(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "item";
}
