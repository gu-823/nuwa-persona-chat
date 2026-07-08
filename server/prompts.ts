import type { ChatMessage, Persona, ResearchResult } from "./types.js";

const EXIT_RE = /(退出|切回正常|不用扮演了|跳出角色|别演了|stop|停一下)/i;

export function shouldExitRole(text: string): boolean {
  return EXIT_RE.test(text);
}

export function buildMessagesForPersona(
  persona: Persona,
  history: ChatMessage[],
  options: {
    mode: "persona" | "normal";
    firstPersonaReply: boolean;
    research?: ResearchResult;
  }
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const system = options.mode === "normal"
    ? buildNormalSystem(persona)
    : buildPersonaSystem(persona, options.firstPersonaReply, options.research);

  const recentHistory = history.slice(-14).map((message) => ({
    role: message.role,
    content: message.content
  }));

  return [{ role: "system", content: system }, ...recentHistory];
}

export function sanitizePersonaReply(
  _persona: Persona,
  answer: string,
  options: { firstPersonaReply: boolean }
): string {
  const trimmed = answer.trim();
  if (!breaksImmersion(trimmed)) return trimmed;

  const disclosure = "（AI 蒸馏模拟，基于公开资料与 skill 推断，非本人。）";
  const existingDisclosure = trimmed.startsWith(disclosure);
  const prefix = options.firstPersonaReply || existingDisclosure ? `${disclosure}\n\n` : "";
  const fallback = [
    "把问题放到桌上。别先分类，也别绕弯子：人、局面、筹码，还有你最犹豫的那一下。",
    "我会按我的方式切进去：先看真实约束，再看幻觉，最后给你一个能行动的判断。"
  ].join("\n\n");

  return `${prefix}${fallback}`.trim();
}

export function buildDistillPrompt(input: {
  personName: string;
  purpose: string;
  materials: string;
  research?: ResearchResult;
  nuwaGuide: string;
  template: string;
  framework: string;
}): Array<{ role: "system" | "user"; content: string }> {
  const researchBlock = input.research
    ? input.research.sources
        .map((source, index) => `[#${index + 1}] ${source.title}\n${source.url}\n${source.description || ""}\n${source.markdown || ""}`)
        .join("\n\n")
    : "未配置实时检索或未获得检索结果。";

  return [
    {
      role: "system",
      content: [
        "你是女娲 skill 的执行器，负责把公开资料蒸馏成可运行的人物 SKILL.md。",
        "只输出完整 Markdown 文件，不要输出解释、寒暄或代码围栏。",
        "必须包含 YAML frontmatter、角色扮演规则、身份卡、核心心智模型、决策启发式、表达DNA、诚实边界和调研来源。",
        "不要声称生成的人物是真人本人；它是基于公开资料的认知蒸馏。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标人物：${input.personName}`,
        `用途：${input.purpose || "作为思维顾问，与用户深度对话"}`,
        "",
        "用户提供资料：",
        input.materials || "无",
        "",
        "实时/公开检索资料：",
        researchBlock,
        "",
        "女娲方法摘要：",
        input.nuwaGuide,
        "",
        "提炼框架：",
        input.framework,
        "",
        "输出模板：",
        input.template
      ].join("\n")
    }
  ];
}

export function buildNuwaSynthesisPrompt(input: {
  personName: string;
  purpose: string;
  materials: string;
  researchMarkdown: string;
  framework: string;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是女娲 Phase 2 的框架提炼器。",
        "你的任务不是写最终 SKILL.md，而是把 6 维调研材料提炼成可构建 Skill 的结构化 synthesis。",
        "必须区分一手资料、二手资料和推断；必须保留矛盾、争议和信息不足。",
        "只输出 Markdown，不要代码围栏。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标人物：${input.personName}`,
        `用途：${input.purpose || "作为思维顾问，与用户深度对话"}`,
        "",
        "用户提供素材：",
        input.materials || "无",
        "",
        "女娲提炼方法论：",
        input.framework,
        "",
        "6 维调研材料：",
        input.researchMarkdown,
        "",
        "请按以下结构输出 synthesis：",
        "## 调研质量摘要",
        "- 用表格列出 01-06 每个维度的来源数量、关键发现、信息缺口。",
        "## 核心心智模型（3-7 个）",
        "- 每个模型必须包含：名称、一句话、跨域证据、生成力、排他性、应用、局限。",
        "## 决策启发式（5-10 条）",
        "- 每条写成可触发规则，并给出案例依据。",
        "## 表达 DNA",
        "- 句式、词汇、节奏、幽默、确定性、引用习惯。",
        "## 价值观、反模式与核心张力",
        "## 智识谱系",
        "## 回答工作流研究维度",
        "- 从心智模型反推 3-5 个遇到事实问题时应优先研究的维度。",
        "## 诚实边界",
        "- 标注调研时间、资料局限、推断比例、不能覆盖的部分。",
        "## 可用于最终 Skill 的关键来源"
      ].join("\n")
    }
  ];
}

export function buildNuwaSkillPrompt(input: {
  personName: string;
  purpose: string;
  slug: string;
  synthesis: string;
  researchMarkdown: string;
  nuwaGuide: string;
  template: string;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是女娲 Phase 3 的 Skill 构建器。",
        "你必须根据 synthesis 和模板生成完整、可运行的人物 SKILL.md。",
        "只输出完整 Markdown 文件，不要解释、寒暄或代码围栏。",
        "不得编造来源或原话；不确定的内容要写进诚实边界。",
        "frontmatter description 必须简洁，控制在 700 字以内。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标人物：${input.personName}`,
        `建议 skill name：${input.slug}-perspective`,
        `用途：${input.purpose || "作为思维顾问，与用户深度对话"}`,
        "",
        "女娲方法摘要：",
        input.nuwaGuide,
        "",
        "标准模板：",
        input.template,
        "",
        "Phase 2 synthesis：",
        input.synthesis,
        "",
        "6 维调研材料索引：",
        input.researchMarkdown,
        "",
        "生成要求：",
        "- 必须包含 YAML frontmatter、角色扮演规则、回答工作流（Agentic Protocol）、身份卡、核心心智模型、决策启发式、表达DNA、时间线、价值观与反模式、智识谱系、诚实边界、调研来源。",
        "- 角色扮演规则必须要求第一人称沉浸回应，不说“他会认为”。",
        "- 回答工作流中的研究维度必须来自该人物的心智模型，不要写通用搜索建议。",
        "- 调研来源必须明确写：调研过程详见 `references/research/`。",
        "- 结尾保留女娲创建者归属。"
      ].join("\n")
    }
  ];
}

export function buildNuwaQualityPrompt(input: {
  personName: string;
  markdown: string;
  synthesis: string;
  framework: string;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是女娲 Phase 4 的质量验证器。",
        "你要严格审查 SKILL.md 是否像一个可运行的认知操作系统，而不是泛泛人物介绍。",
        "输出 Markdown 质量报告，不要代码围栏。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标人物：${input.personName}`,
        "",
        "质量自检方法论：",
        input.framework,
        "",
        "Phase 2 synthesis：",
        input.synthesis,
        "",
        "待检查 SKILL.md：",
        input.markdown,
        "",
        "请输出：",
        "## 质量结论",
        "- PASS / NEEDS_REVISION，并给出一句话原因。",
        "## 检查表",
        "- 心智模型数量与证据、局限性、表达DNA、诚实边界、内在张力、一手来源占比、防漂移规则。",
        "## 三项测试",
        "- 已知测试、边缘测试、风格测试，各给一个短样例和评价。",
        "## 必须修订的具体问题",
        "- 用可执行修改建议列出，不要泛泛而谈。"
      ].join("\n")
    }
  ];
}

export function buildNuwaRevisionPrompt(input: {
  markdown: string;
  qualityReport: string;
}): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是女娲 Phase 5 的精炼器。",
        "根据质量报告修订 SKILL.md，只做能提升可运行性、沉浸感、诚实边界和防漂移的改动。",
        "只输出修订后的完整 Markdown 文件，不要解释或代码围栏。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "质量报告：",
        input.qualityReport,
        "",
        "原始 SKILL.md：",
        input.markdown
      ].join("\n")
    }
  ];
}

function buildPersonaSystem(persona: Persona, firstPersonaReply: boolean, research?: ResearchResult): string {
  const disclosure = firstPersonaReply
    ? "这是本会话该人物的首次回复。第一句必须短句披露：`（AI 蒸馏模拟，基于公开资料与 skill 推断，非本人。）`，之后立即进入角色。后续回复不要重复这句。"
    : "本会话已披露 AI 蒸馏模拟身份，除非用户问起，不要反复解释。";

  const researchBlock = research
    ? [
        "以下是刚刚检索到的当下资料。涉及具体事实时优先使用这些资料，不要编造来源：",
        ...research.sources.map(
          (source, index) =>
            `[#${index + 1}] ${source.title}\nURL: ${source.url}\n摘要: ${source.description || ""}\n${source.markdown?.slice(0, 1500) || ""}`
        )
      ].join("\n\n")
    : "没有可用实时检索资料。涉及最新事实时，应诚实说明未检索，不要把旧知识伪装成当下事实。";

  return [
    "你是一个人物思维蒸馏聊天应用中的 AI。你要依据下方人物 skill 模拟其认知框架、语气、节奏和决策启发式。",
    "允许使用第一人称来保持沉浸，但不得声称自己是真人本人、拥有非公开记忆、正在现实中亲自行动，或代表本人观点。",
    "沉浸式对话硬规则：除首次短句披露外，始终像正在当面对谈一样直接回应。不要站在应用、客服、主持人、旁白或“思维顾问产品”的角度说话。",
    "不要把当前人物称为“他/她/该人物/这位人物”，不要说“听他口吻”“用他的视角”“模拟这个人”“我来处理”这类工具化表达。需要说明边界时，用第一人称短句说“我只能根据公开资料推断”。",
    "如果用户输入很短或含糊，先用人物式反应接住，再问一个具体问题。不要让用户在“分析某个决策 / 预判下一步动作 / 听口吻聊两句”这类菜单里选择。",
    "绝对不要输出或改写这个反例：分析他的某个决策、预判下一步动作、还是单纯想听他口吻聊两句？说清楚点，我来处理。",
    "如果用户要求退出角色，立刻恢复普通 AI 助手语气。",
    disclosure,
    `当前日期：${new Date().toISOString().slice(0, 10)}`,
    researchBlock,
    "人物 skill 原文如下：",
    persona.markdown
  ].join("\n\n");
}

function buildNormalSystem(persona: Persona): string {
  return [
    "你是普通 AI 助手。用户已要求退出人物角色，因此不要再用该人物第一人称说话。",
    "你可以参考人物 skill 解释其思维框架，但必须用第三人称、透明地说明这是分析而非扮演。",
    `当前上下文人物：${persona.title}`,
    persona.markdown.slice(0, 8000)
  ].join("\n\n");
}

function breaksImmersion(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return [
    /分析[他她](?:的)?某个决策.*预判下一步动作.*听[他她](?:的)?口吻/,
    /预判下一步动作.*听[他她](?:的)?口吻/,
    /听[他她](?:的)?口吻聊两句/,
    /说清楚点[，,]?我来处理/,
    /你想让我做什么[？?]?.*(分析|预判|口吻)/
  ].some((pattern) => pattern.test(compact));
}
