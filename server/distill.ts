import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { completeChat, isChatConfigured } from "./llm.js";
import { normalizeId, parsePersona } from "./personas.js";
import {
  buildDistillPrompt,
  buildNuwaQualityPrompt,
  buildNuwaRevisionPrompt,
  buildNuwaSkillPrompt,
  buildNuwaSynthesisPrompt
} from "./prompts.js";
import { isResearchConfigured, runResearch } from "./research.js";
import { saveCustomPersona } from "./storage.js";
import type { ResearchResult, ResearchSource } from "./types.js";

export type DistillDepth = "quick" | "standard";
export type DistillProgress = (message: string) => void;

interface DistillInput {
  personName: string;
  purpose?: string;
  materials?: string;
  depth?: DistillDepth;
}

interface ResearchDimension {
  id: string;
  fileName: string;
  title: string;
  goal: string;
  zhQuery: string;
  enQuery: string;
}

interface ResearchDoc {
  dimension: ResearchDimension;
  query: string;
  sources: ResearchSource[];
  markdown: string;
  error?: string;
}

const RESEARCH_DIMENSIONS: ResearchDimension[] = [
  {
    id: "01",
    fileName: "01-writings.md",
    title: "著作与系统思考",
    goal: "书籍、长文、论文、newsletter、自创概念和反复出现的核心论点。",
    zhQuery: "著作 长文 书籍 文章 核心观点 思想体系 自创概念",
    enQuery: "books essays writings longform core ideas philosophy original concepts"
  },
  {
    id: "02",
    fileName: "02-conversations.md",
    title: "长对话与即兴思考",
    goal: "播客、访谈、演讲、AMA、被追问时的回答方式和改变立场的瞬间。",
    zhQuery: "访谈 播客 演讲 长视频 对话 回答 思考方式",
    enQuery: "interviews podcasts talks AMA conversations thinking process"
  },
  {
    id: "03",
    fileName: "03-expression-dna.md",
    title: "碎片表达与表达 DNA",
    goal: "社交媒体、短文、公开辩论、高频词、句式、幽默方式和禁忌词。",
    zhQuery: "微博 推特 社交媒体 公开发言 语录 表达风格 争议",
    enQuery: "Twitter X social media quotes public remarks expression style debates"
  },
  {
    id: "04",
    fileName: "04-external-views.md",
    title: "他者视角与批评",
    goal: "传记、同行评价、批评、争议、盲点和外部观察到的行为模式。",
    zhQuery: "评价 批评 传记 争议 同行看法 外部评价",
    enQuery: "biography criticism controversy peer views external analysis"
  },
  {
    id: "05",
    fileName: "05-decisions.md",
    title: "重大决策与行动记录",
    goal: "关键决策、人生转折、争议行为、事后反思和言行一致/不一致案例。",
    zhQuery: "重大决策 关键选择 转折点 行动记录 争议 复盘",
    enQuery: "major decisions turning points actions controversy retrospective"
  },
  {
    id: "06",
    fileName: "06-timeline.md",
    title: "时间线与最新动态",
    goal: "完整人生/事业时间线、思想转折点、最近 12 个月动态。",
    zhQuery: "时间线 生平 经历 最新动态 2025 2026 近况",
    enQuery: "timeline biography recent updates 2025 2026 milestones"
  }
];

export async function distillPersona(
  input: DistillInput,
  onProgress: DistillProgress = () => {}
): Promise<{ id: string; filePath: string; depth: DistillDepth; researchFiles?: string[]; qualityReportPath?: string }> {
  if (!isChatConfigured()) {
    throw new Error("LONGCAT_API_KEY is required to distill a new persona.");
  }

  const personName = input.personName.trim();
  if (!personName) {
    throw new Error("personName is required.");
  }

  const depth: DistillDepth = input.depth === "quick" ? "quick" : "standard";
  if (depth === "quick") {
    return distillQuick({ ...input, personName }, onProgress);
  }

  return distillStandard({ ...input, personName }, onProgress);
}

async function distillQuick(
  input: DistillInput & { personName: string },
  onProgress: DistillProgress
): Promise<{ id: string; filePath: string; depth: DistillDepth }> {
  onProgress("快速预览：正在检索公开资料...");
  const research = isResearchConfigured()
    ? await runResearch(`${input.personName} interviews writings biography thinking style public record`)
    : undefined;

  onProgress("快速预览：正在读取女娲模板...");
  const [nuwaGuide, template, framework] = await Promise.all([
    readNuwaFile("SKILL.md", 9000),
    readNuwaFile(path.join("references", "skill-template.md"), 7000),
    readNuwaFile(path.join("references", "extraction-framework.md"), 7000)
  ]);

  const messages = buildDistillPrompt({
    personName: input.personName,
    purpose: input.purpose || "",
    materials: input.materials || "",
    research,
    nuwaGuide,
    template,
    framework
  });

  onProgress("快速预览：正在生成 SKILL.md...");
  const raw = await completeChat(messages, { temperature: 0.72, maxTokens: 6500 });
  const markdown = cleanSkillMarkdown(raw);
  const parsed = parsePersona("SKILL.md", markdown, true);
  const slug = normalizeId(parsed.skillName || `${input.personName}-perspective`);
  onProgress("快速预览：正在写入自定义人物...");
  const filePath = await saveCustomPersona(slug, markdown);

  return { id: slug, filePath, depth: "quick" };
}

async function distillStandard(
  input: DistillInput & { personName: string },
  onProgress: DistillProgress
): Promise<{ id: string; filePath: string; depth: DistillDepth; researchFiles: string[]; qualityReportPath: string }> {
  const slug = normalizeId(`${input.personName}-perspective`);
  const materials = input.materials || "";

  onProgress("标准女娲：正在并行执行 6 维调研...");
  const [nuwaGuide, template, framework, researchDocs] = await Promise.all([
    readNuwaFile("SKILL.md", 11000),
    readNuwaFile(path.join("references", "skill-template.md"), 8000),
    readNuwaFile(path.join("references", "extraction-framework.md"), 9000),
    collectResearchDocs(input.personName, materials)
  ]);

  const researchMarkdown = researchDocs.map((doc) => truncate(doc.markdown, 6500)).join("\n\n---\n\n");
  onProgress("标准女娲：正在做 Phase 2 框架提炼...");
  const synthesis = cleanMarkdown(
    await completeChat(
      buildNuwaSynthesisPrompt({
        personName: input.personName,
        purpose: input.purpose || "",
        materials,
        researchMarkdown,
        framework
      }),
      { temperature: 0.48, maxTokens: 7000 }
    )
  );

  onProgress("标准女娲：正在构建完整 SKILL.md...");
  const draftMarkdown = cleanSkillMarkdown(
    await completeChat(
      buildNuwaSkillPrompt({
        personName: input.personName,
        purpose: input.purpose || "",
        slug,
        synthesis,
        researchMarkdown: buildResearchIndex(researchDocs),
        nuwaGuide,
        template
      }),
      { temperature: 0.62, maxTokens: 8500 }
    )
  );

  onProgress("标准女娲：正在质量审校...");
  const qualityReport = cleanMarkdown(
    await completeChat(
      buildNuwaQualityPrompt({
        personName: input.personName,
        markdown: draftMarkdown,
        synthesis,
        framework
      }),
      { temperature: 0.32, maxTokens: 3600 }
    )
  );

  onProgress("标准女娲：正在根据审校报告精炼...");
  const finalMarkdown = cleanSkillMarkdown(
    await completeChat(
      buildNuwaRevisionPrompt({
        markdown: draftMarkdown,
        qualityReport
      }),
      { temperature: 0.42, maxTokens: 8500 }
    )
  );

  const parsed = parsePersona("SKILL.md", finalMarkdown, true);
  const finalSlug = normalizeId(parsed.skillName || `${input.personName}-perspective`) || slug;
  onProgress("标准女娲：正在写入 Skill 和调研档案...");
  const filePath = await saveCustomPersona(finalSlug, finalMarkdown);
  const artifactPaths = await saveNuwaArtifacts(path.dirname(filePath), {
    personName: input.personName,
    purpose: input.purpose || "",
    materials,
    researchDocs,
    synthesis,
    qualityReport
  });

  return {
    id: finalSlug,
    filePath,
    depth: "standard",
    researchFiles: artifactPaths.researchFiles,
    qualityReportPath: artifactPaths.qualityReportPath
  };
}

async function readNuwaFile(relativePath: string, maxChars: number): Promise<string> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const filePath = path.join(codexHome, "skills", "huashu-nuwa", relativePath);
  const text = await fs.readFile(filePath, "utf8");
  return text.slice(0, maxChars);
}

function cleanSkillMarkdown(raw: string): string {
  const withoutFence = raw
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (/^---\s*$/m.test(withoutFence) && /^#\s+/m.test(withoutFence)) {
    return withoutFence;
  }

  return [
    "---",
    "name: custom-persona-perspective",
    "description: |",
    "  用户通过女娲 Web App 蒸馏生成的人物思维框架。",
    "---",
    "",
    withoutFence
  ].join("\n");
}

async function collectResearchDocs(personName: string, materials: string): Promise<ResearchDoc[]> {
  if (!isResearchConfigured()) {
    return RESEARCH_DIMENSIONS.map((dimension) =>
      buildResearchDoc({
        dimension,
        query: "未配置搜索提供方",
        result: undefined,
        materials,
        error: "未配置豆包搜索或 Firecrawl，标准档只能使用用户提供素材。"
      })
    );
  }

  return Promise.all(
    RESEARCH_DIMENSIONS.map(async (dimension) => {
      const query = buildResearchQuery(personName, dimension);
      try {
        const result = await runResearch(query);
        return buildResearchDoc({ dimension, query, result, materials });
      } catch (error) {
        return buildResearchDoc({
          dimension,
          query,
          result: undefined,
          materials,
          error: error instanceof Error ? error.message : "Research failed."
        });
      }
    })
  );
}

function buildResearchDoc(input: {
  dimension: ResearchDimension;
  query: string;
  result?: ResearchResult;
  materials: string;
  error?: string;
}): ResearchDoc {
  const sources = (input.result?.sources || []).filter((source) => !isBlockedSource(source)).slice(0, 6);
  const lines = [
    `# ${input.dimension.id} ${input.dimension.title}`,
    "",
    `**Agent 目标**：${input.dimension.goal}`,
    `**搜索 Query**：${input.query}`,
    `**调研时间**：${new Date().toISOString().slice(0, 10)}`,
    `**可用来源数**：${sources.length}`,
    ""
  ];

  if (input.error) {
    lines.push("## 调研异常", "", input.error, "");
  }

  if (input.materials.trim()) {
    lines.push("## 用户提供素材线索", "", truncate(input.materials.trim(), 1800), "");
  }

  lines.push("## 来源摘录", "");
  if (!sources.length) {
    lines.push("暂无可用外部来源。该维度必须在最终 Skill 的诚实边界中标注资料不足。", "");
  } else {
    sources.forEach((source, index) => {
      lines.push(
        `### [${index + 1}] ${source.title || "未命名来源"}`,
        `- URL：${source.url || "无"}`,
        `- 来源层级：${sourceConfidence(source)}`,
        `- 摘要：${source.description || "无"}`,
        "",
        truncate(source.markdown || source.description || "", 2400),
        ""
      );
    });
  }

  lines.push(
    "## 提取提醒",
    "",
    "- 区分「本人直接表达」与「他者评价」。",
    "- 保留矛盾与争议，不要强行调和。",
    "- 不使用知乎、微信公众号、百度百科作为证据。"
  );

  return {
    dimension: input.dimension,
    query: input.query,
    sources,
    markdown: lines.join("\n"),
    error: input.error
  };
}

function buildResearchQuery(personName: string, dimension: ResearchDimension): string {
  const hasCjk = /\p{Script=Han}/u.test(personName);
  const terms = hasCjk ? dimension.zhQuery : dimension.enQuery;
  const blacklist = hasCjk ? "-知乎 -微信公众号 -百度百科" : "-zhihu -weixin -baidu";
  return `${personName} ${terms} ${blacklist}`.trim();
}

function buildResearchIndex(researchDocs: ResearchDoc[]): string {
  return researchDocs
    .map((doc) => {
      const sourceList = doc.sources
        .slice(0, 4)
        .map((source, index) => `  ${index + 1}. ${source.title} — ${source.url}`)
        .join("\n");
      return [
        `## ${doc.dimension.fileName}`,
        `- 维度：${doc.dimension.title}`,
        `- Query：${doc.query}`,
        `- 来源数：${doc.sources.length}`,
        doc.error ? `- 异常：${doc.error}` : "",
        sourceList || "  无外部来源"
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

async function saveNuwaArtifacts(
  targetDir: string,
  input: {
    personName: string;
    purpose: string;
    materials: string;
    researchDocs: ResearchDoc[];
    synthesis: string;
    qualityReport: string;
  }
): Promise<{ researchFiles: string[]; qualityReportPath: string }> {
  const referencesDir = path.join(targetDir, "references");
  const researchDir = path.join(referencesDir, "research");
  const sourcesDir = path.join(referencesDir, "sources");
  await Promise.all([
    fs.mkdir(researchDir, { recursive: true }),
    fs.mkdir(sourcesDir, { recursive: true })
  ]);

  const researchFiles = await Promise.all(
    input.researchDocs.map(async (doc) => {
      const filePath = path.join(researchDir, doc.dimension.fileName);
      await fs.writeFile(filePath, doc.markdown, "utf8");
      return filePath;
    })
  );

  await fs.writeFile(path.join(researchDir, "00-review.md"), buildReviewMarkdown(input), "utf8");
  await fs.writeFile(path.join(referencesDir, "synthesis.md"), input.synthesis, "utf8");
  const qualityReportPath = path.join(referencesDir, "quality-report.md");
  await fs.writeFile(qualityReportPath, input.qualityReport, "utf8");

  if (input.materials.trim()) {
    await fs.writeFile(path.join(sourcesDir, "user-materials.md"), input.materials.trim(), "utf8");
  }

  return { researchFiles, qualityReportPath };
}

function buildReviewMarkdown(input: {
  personName: string;
  purpose: string;
  researchDocs: ResearchDoc[];
}): string {
  const rows = input.researchDocs
    .map(
      (doc) =>
        `| ${doc.dimension.id} ${doc.dimension.title} | ${doc.sources.length} | ${doc.error ? `异常：${doc.error}` : doc.sources[0]?.title || "资料不足"} |`
    )
    .join("\n");

  return [
    `# ${input.personName} · 女娲标准档调研 Review`,
    "",
    `用途：${input.purpose || "作为思维顾问，与用户深度对话"}`,
    `时间：${new Date().toISOString()}`,
    "",
    "| 维度 | 来源数量 | 关键发现 / 风险 |",
    "|---|---:|---|",
    rows,
    "",
    "## 检查点结论",
    "",
    "- 6 个维度均已生成调研文件；来源不足的维度会进入最终 Skill 的诚实边界。",
    "- 黑名单来源（知乎、微信公众号、百度百科、百度知道）已在写入前过滤。",
    "- 完整 synthesis 和质量验证见 `../synthesis.md` 与 `../quality-report.md`。"
  ].join("\n");
}

function cleanMarkdown(raw: string): string {
  return raw
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[已截断]` : value;
}

function isBlockedSource(source: ResearchSource): boolean {
  const text = `${source.title} ${source.url} ${source.description || ""}`.toLowerCase();
  return /(zhihu\.com|知乎|mp\.weixin\.qq\.com|微信公众号|baidu\.com|百度百科|百度知道|baike\.baidu)/i.test(text);
}

function sourceConfidence(source: ResearchSource): string {
  const text = `${source.title} ${source.url} ${source.description || ""}`.toLowerCase();
  if (/(official|官网|本人|interview|访谈|speech|演讲|youtube|youtu\.be|x\.com|twitter|微博|substack|medium|podcast|播客)/i.test(text)) {
    return "一手或接近一手，仍需核验原文";
  }
  if (/(biography|传记|review|criticism|批评|analysis|评价|profile)/i.test(text)) {
    return "二手分析，可用于外部视角";
  }
  return "待核验来源";
}
