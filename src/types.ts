export interface PersonaSections {
  models: string;
  honesty: string;
  sources: string;
}

export interface Persona {
  id: string;
  skillName: string;
  displayName: string;
  title: string;
  description: string;
  avatarUrl?: string;
  sourcePath: string;
  isCustom: boolean;
  accent: string;
  sections: PersonaSections;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: ResearchSource[];
}

export interface ChatSession {
  id: string;
  personaId: string;
  mode: "persona" | "normal";
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatSummary {
  id: string;
  personaId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export interface ResearchSource {
  title: string;
  url: string;
  description?: string;
  markdown?: string;
}

export interface ClientConfig {
  chatConfigured: boolean;
  researchConfigured: boolean;
  researchProvider: "doubao" | "firecrawl" | "none";
  model: string;
}

export interface DistillJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
  personName: string;
  depth: "standard" | "quick";
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: {
    id: string;
    filePath: string;
    depth: "standard" | "quick";
    researchFiles?: string[];
    qualityReportPath?: string;
  };
  error?: string;
}

export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "delta"; delta: string }
  | { type: "sources"; sources: ResearchSource[] }
  | { type: "research-error"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; message: ChatMessage };
