import fs from "node:fs/promises";
import path from "node:path";
import { CUSTOM_PERSONAS_DIR, ROOT_DIR } from "./paths.js";
import type { Persona, PersonaSections } from "./types.js";

const seedPersonaFiles = [
  path.join(ROOT_DIR, "Jobs.md"),
  path.join(ROOT_DIR, "Musk.md"),
  path.join(ROOT_DIR, "Trump.md"),
  path.join(ROOT_DIR, "张雪峰.md"),
  path.resolve("E:/solo/女娲/distilled-skills/cai-xukun/SKILL.md"),
  path.resolve("E:/solo/女娲/distilled-skills/karl-marx/SKILL.md"),
  path.resolve("E:/solo/女娲/distilled-skills/mao-zedong/SKILL.md"),
  path.resolve("E:/solo/女娲/distilled-skills/socrates/SKILL.md"),
  path.resolve("E:/solo/女娲/distilled-skills/su-dongpo/SKILL.md")
];

const accentPalette = [
  "#c7a96b",
  "#f1ece0",
  "#a84f3d",
  "#8aa29a",
  "#d7b98c",
  "#b56b6b",
  "#9fb1c8",
  "#d0d6b3",
  "#e0c1a1"
];

const avatarUrls: Record<string, string> = {
  "steve-jobs": "https://commons.wikimedia.org/wiki/Special:FilePath/Steve_Jobs_Headshot_2010-CROP.jpg?width=180",
  "elon-musk": "https://commons.wikimedia.org/wiki/Special:FilePath/Elon_Musk_Royal_Society_%28crop2%29.jpg?width=180",
  trump: "https://commons.wikimedia.org/wiki/Special:FilePath/Donald_Trump_official_portrait.jpg?width=180",
  zhangxuefeng: "https://www.inewsweek.cn/2023/0615/U1085P972DT20230615113054.jpg",
  "cai-xukun": "https://commons.wikimedia.org/wiki/Special:FilePath/Cai_Xukun_in_2018.jpg?width=180",
  "karl-marx": "https://commons.wikimedia.org/wiki/Special:FilePath/Karl_Marx_001.jpg?width=180",
  "mao-zedong": "https://commons.wikimedia.org/wiki/Special:FilePath/Mao_Zedong_1950_Portrait_%283x4_cropped%29%282%29.jpg?width=180",
  socrates: "https://commons.wikimedia.org/wiki/Special:FilePath/Socrates_Louvre.jpg?width=180",
  "su-dongpo": "https://commons.wikimedia.org/wiki/Special:FilePath/Su_Shi.jpg?width=180",
  wangxiaobo: "https://img.caixin.com/2022-04-11/164963836509686_840_560.jpg"
};

export async function loadPersonas(): Promise<Persona[]> {
  const customFiles = await getCustomPersonaFiles();
  const files = [...seedPersonaFiles, ...customFiles];
  const personas: Persona[] = [];

  for (const file of files) {
    try {
      const markdown = await fs.readFile(file, "utf8");
      personas.push(parsePersona(file, markdown, customFiles.includes(file)));
    } catch {
      // A seed file can be absent on another machine; keep the app bootable.
    }
  }

  return personas;
}

export async function getPersona(id: string): Promise<Persona | undefined> {
  const personas = await loadPersonas();
  return personas.find((persona) => persona.id === id);
}

export function parsePersona(sourcePath: string, markdown: string, isCustom = false): Persona {
  const frontmatter = parseFrontmatter(markdown);
  const skillName = frontmatter.name || slugFromPath(sourcePath);
  const title = getFirstHeading(markdown) || skillName;
  const displayName = title.replace(/\s*·\s*思维操作系统.*$/u, "").trim() || skillName.replace(/-perspective$/, "");
  const id = normalizeId(skillName);
  const description = frontmatter.description || "";

  return {
    id,
    skillName,
    displayName,
    title,
    description,
    avatarUrl: avatarUrls[id],
    markdown,
    sourcePath,
    isCustom,
    accent: accentFor(id),
    sections: extractSections(markdown)
  };
}

export function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/-perspective$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

async function getCustomPersonaFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CUSTOM_PERSONAS_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(CUSTOM_PERSONAS_DIR, entry.name, "SKILL.md"));
  } catch {
    return [];
  }
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) continue;

    const key = keyValue[1];
    const value = keyValue[2];

    if (value === "|") {
      const block: string[] = [];
      i += 1;
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === "")) {
        block.push(lines[i].replace(/^\s{2}/, ""));
        i += 1;
      }
      i -= 1;
      result[key] = block.join("\n").trim();
    } else {
      result[key] = value.replace(/^["']|["']$/g, "").trim();
    }
  }

  return result;
}

function getFirstHeading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function extractSections(markdown: string): PersonaSections {
  return {
    models: extractSection(markdown, ["核心心智模型", "心智模型"]).slice(0, 1800),
    honesty: extractSection(markdown, ["诚实边界", "局限", "不擅长"]).slice(0, 1200),
    sources: extractSection(markdown, ["附录：调研来源", "调研来源", "来源"]).slice(0, 1200)
  };
}

function extractSection(markdown: string, names: string[]): string {
  const escapedNames = names.map(escapeRegex).join("|");
  const pattern = new RegExp(`^##+\\s*(?:${escapedNames}).*$`, "im");
  const match = markdown.match(pattern);
  if (!match || match.index === undefined) return "";

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const endMatch = rest.match(/\n##\s+/);
  const body = endMatch?.index === undefined ? rest : rest.slice(0, endMatch.index);
  return body.trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugFromPath(filePath: string): string {
  const parent = path.basename(path.dirname(filePath));
  const basename = path.basename(filePath, path.extname(filePath));
  return basename.toLowerCase() === "skill" ? parent : basename;
}

function accentFor(id: string): string {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return accentPalette[hash % accentPalette.length];
}
