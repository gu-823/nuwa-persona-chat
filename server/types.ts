export type MessageRole = "user" | "assistant" | "system";

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
  markdown: string;
  sourcePath: string;
  isCustom: boolean;
  accent: string;
  sections: PersonaSections;
}

export interface ChatMessage {
  id: string;
  role: Exclude<MessageRole, "system">;
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

export interface ResearchSource {
  title: string;
  url: string;
  description?: string;
  markdown?: string;
}

export interface ResearchResult {
  id: string;
  query: string;
  createdAt: string;
  sources: ResearchSource[];
}

export interface ClientConfig {
  chatConfigured: boolean;
  researchConfigured: boolean;
  researchProvider: "doubao" | "firecrawl" | "none";
  model: string;
}

export interface ChatSummary {
  id: string;
  personaId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}
