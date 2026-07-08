import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(serverDir, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const CHATS_DIR = path.join(DATA_DIR, "chats");
export const RESEARCH_DIR = path.join(DATA_DIR, "research");
export const CUSTOM_PERSONAS_DIR = path.join(DATA_DIR, "personas", "custom");
