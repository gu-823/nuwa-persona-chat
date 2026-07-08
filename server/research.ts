import crypto from "node:crypto";
import { saveResearch } from "./storage.js";
import type { ResearchResult, ResearchSource } from "./types.js";

const FRESH_CONTEXT_RE =
  /(今天|当下|现在|最新|最近|今年|明天|昨天|新闻|价格|股价|市值|政策|法规|选举|民调|战争|公司|产品|竞品|版本|发布|行业|202[4-9]|OpenAI|Anthropic|Vision Pro|特朗普|Trump)/i;

export function isResearchConfigured(): boolean {
  return getResearchProvider() !== "none";
}

export function getResearchProvider(): "doubao" | "firecrawl" | "none" {
  const requested = (process.env.SEARCH_PROVIDER || "").toLowerCase();
  const hasDoubao = Boolean(doubaoKey());
  const hasFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY);

  if (requested === "firecrawl") return hasFirecrawl ? "firecrawl" : "none";
  if (requested === "doubao") return hasDoubao ? "doubao" : "none";
  if (hasDoubao) return "doubao";
  if (hasFirecrawl) return "firecrawl";
  return "none";
}

export function needsFreshContext(text: string): boolean {
  return FRESH_CONTEXT_RE.test(text);
}

export async function runResearch(query: string): Promise<ResearchResult> {
  const provider = getResearchProvider();
  if (provider === "doubao") {
    return runDoubaoResearch(query);
  }
  if (provider === "firecrawl") {
    return runFirecrawlResearch(query);
  }
  throw new Error("Search provider is not configured.");
}

async function runFirecrawlResearch(query: string): Promise<ResearchResult> {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is not configured.");
  }

  const response = await fetch(searchUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({
      query,
      limit: 5,
      sources: ["web"],
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 10000
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Firecrawl search failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json() as {
    data?: Array<Partial<ResearchSource>>;
    results?: Array<Partial<ResearchSource>>;
  };

  const rawSources = json.data || json.results || [];
  const sources = rawSources
    .filter((source) => source.url)
    .map((source) => ({
      title: source.title || source.url || "Untitled source",
      url: source.url || "",
      description: source.description || "",
      markdown: source.markdown?.slice(0, 4000) || ""
    }));

  const result: ResearchResult = {
    id: crypto.randomUUID(),
    query,
    createdAt: new Date().toISOString(),
    sources
  };

  await saveResearch(result);
  return result;
}

async function runDoubaoResearch(query: string): Promise<ResearchResult> {
  const key = doubaoKey();
  if (!key) {
    throw new Error("DOUBAO_SEARCH_API_KEY is not configured.");
  }

  if (isLegacyAsyncDoubaoUrl()) {
    return runLegacyAsyncDoubaoResearch(query, key);
  }

  const response = await fetch(doubaoUrl(), {
    method: "POST",
    headers: doubaoHeaders(key),
    body: JSON.stringify({
      Query: query,
      SearchType: "web",
      Count: 5,
      Filter: {
        NeedContent: true,
        NeedUrl: true
      },
      NeedSummary: true
    })
  });

  if (!response.ok) {
    throw new Error(`Doubao search failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  assertDoubaoBusinessOk(json, "request");
  const result = normalizeDoubaoResult(query, json);
  await saveResearch(result);
  return result;
}

async function runLegacyAsyncDoubaoResearch(query: string, key: string): Promise<ResearchResult> {
  const submitResponse = await fetch(doubaoUrl("submit"), {
    method: "POST",
    headers: doubaoHeaders(key),
    body: JSON.stringify({
      inquiry_text: query,
      source: "doubaowebsearch-Codex"
    })
  });

  if (!submitResponse.ok) {
    throw new Error(`Doubao search submit failed: ${submitResponse.status} ${await submitResponse.text()}`);
  }

  const submitJson = await submitResponse.json();
  assertDoubaoBusinessOk(submitJson, "submit");
  const taskId = pickTaskId(submitJson);
  if (!taskId) {
    const result = normalizeDoubaoResult(query, submitJson);
    await saveResearch(result);
    return result;
  }

  let lastJson: unknown = submitJson;
  const maxPolls = Number(process.env.DOUBAO_SEARCH_MAX_POLLS || 8);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await delay(attempt === 0 ? 1200 : 5000);
    const resultResponse = await fetch(doubaoUrl("result"), {
      method: "POST",
      headers: doubaoHeaders(key),
      body: JSON.stringify({ taskId })
    });

    if (!resultResponse.ok) {
      throw new Error(`Doubao search result failed: ${resultResponse.status} ${await resultResponse.text()}`);
    }

    lastJson = await resultResponse.json();
    assertDoubaoBusinessOk(lastJson, "result");
    if (isDoubaoCompleted(lastJson)) {
      const result = normalizeDoubaoResult(query, lastJson);
      await saveResearch(result);
      return result;
    }
  }

  const result = normalizeDoubaoResult(query, lastJson);
  await saveResearch(result);
  return result;
}

function firecrawlSearchUrl(): string {
  const raw = process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev";
  const base = raw.replace(/\/+$/, "");
  return /\/v2\/search$/.test(base) ? base : `${base}/v2/search`;
}

function searchUrl(): string {
  return firecrawlSearchUrl();
}

function doubaoKey(): string {
  return process.env.DOUBAO_SEARCH_API_KEY || process.env.REDFOX_API_KEY || "";
}

function doubaoUrl(action?: "submit" | "result"): string {
  const raw = process.env.DOUBAO_SEARCH_API_URL || "https://open.feedcoopapi.com/search_api/web_search";
  const base = raw.replace(/\/+$/, "");
  if (!action) return base;
  if (base.endsWith(`/${action}`)) return base;
  return `${base}/${action}`;
}

function doubaoHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-KEY": key,
    Authorization: `Bearer ${key}`
  };
}

function isLegacyAsyncDoubaoUrl(): boolean {
  return /doubaoSearch\/?$/i.test(process.env.DOUBAO_SEARCH_API_URL || "");
}

function pickTaskId(value: unknown): string {
  const record = asRecord(value);
  return String(record.taskId || asRecord(record.data).taskId || asRecord(record.data).id || "").trim();
}

function isDoubaoCompleted(value: unknown): boolean {
  const record = asRecord(value);
  const data = asRecord(record.data);
  const status = String(record.status || record.state || data.status || data.state || "").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "done"].includes(status)) return true;
  if (record.code === 2000 && (data.content || data.result)) return true;
  if (data.content || data.result) return true;
  return false;
}

function normalizeDoubaoResult(query: string, value: unknown): ResearchResult {
  const record = asRecord(value);
  const data = asRecord(record.data);
  const resultRecord = asRecord(record.Result);
  const content = String(
    data.content || record.content || resultRecord.Summary || resultRecord.SummaryText || resultRecord.Answer || ""
  );
  const rawResults = Array.isArray(resultRecord.WebResults)
    ? resultRecord.WebResults
    : Array.isArray(resultRecord.SearchResults)
      ? resultRecord.SearchResults
      : Array.isArray(resultRecord.Results)
        ? resultRecord.Results
        : Array.isArray(data.result)
          ? data.result
          : Array.isArray(data.results)
            ? data.results
            : Array.isArray(record.result)
              ? record.result
              : [];

  const sources = rawResults
    .map((item, index) => normalizeSource(item, index))
    .filter((source): source is ResearchSource => Boolean(source));

  if (content && !sources.length) {
    sources.push({
      title: "豆包搜索综合结果",
      url: `https://www.doubao.com/search?q=${encodeURIComponent(query)}`,
      description: content.slice(0, 220),
      markdown: content.slice(0, 4000)
    });
  }

  return {
    id: crypto.randomUUID(),
    query,
    createdAt: new Date().toISOString(),
    sources
  };
}

function assertDoubaoBusinessOk(value: unknown, stage: string): void {
  const record = asRecord(value);
  const responseMetadata = asRecord(record.ResponseMetadata);
  const metadataError = asRecord(responseMetadata.Error);
  if (metadataError.Code || metadataError.Message) {
    throw new Error(`Doubao search ${stage} failed: ${metadataError.Message || metadataError.Code}`);
  }

  const code = record.code;
  if (code === undefined || code === null || code === 0 || code === 200 || code === 2000 || code === "0") {
    return;
  }

  const message = String(record.msg || record.message || record.error || "unknown business error");
  throw new Error(`Doubao search ${stage} failed: ${message}`);
}

function normalizeSource(value: unknown, index: number): ResearchSource | undefined {
  const item = asRecord(value);
  const url = String(item.Url || item.url || item.link || item.href || item.sourceUrl || item.site_url || "").trim();
  const title = String(
    item.Title || item.title || item.name || item.SiteName || item.siteName || item.source || `豆包搜索来源 ${index + 1}`
  ).trim();
  const snippets = Array.isArray(item.Snippet)
    ? item.Snippet.map((snippet) => String(snippet)).join("\n")
    : String(item.Snippet || item.snippet || "");
  const description = String(
    item.Description || item.description || snippets || item.summary || item.Summary || item.Content || item.content || ""
  ).trim();

  if (!url && !description) return undefined;

  return {
    title,
    url: url || `https://www.doubao.com/search?q=${encodeURIComponent(title)}`,
    description,
    markdown: description.slice(0, 4000)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
