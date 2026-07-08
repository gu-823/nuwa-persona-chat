import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  BrainCircuit,
  Check,
  FilePlus2,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Sparkles,
  X
} from "lucide-react";
import {
  createChat,
  distillPersona,
  getDistillJob,
  getChat,
  getChatHistory,
  getConfig,
  getPersonas,
  runResearch,
  sendMessageStream
} from "./api";
import { IntroLoader } from "./IntroLoader";
import type { ChatMessage, ChatSession, ChatSummary, ClientConfig, DistillJob, Persona, ResearchSource } from "./types";

interface PersonaRuntime {
  chat: ChatSession | null;
  chatHistory: ChatSummary[];
  messages: ChatMessage[];
  sources: ResearchSource[];
  input: string;
  forceResearch: boolean;
  status: string;
  streaming: boolean;
  error: string;
}

function createEmptyRuntime(): PersonaRuntime {
  return {
    chat: null,
    chatHistory: [],
    messages: [],
    sources: [],
    input: "",
    forceResearch: false,
    status: "",
    streaming: false,
    error: ""
  };
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [runtimes, setRuntimes] = useState<Record<string, PersonaRuntime>>({});
  const [distillOpen, setDistillOpen] = useState(false);
  const [distillJobs, setDistillJobs] = useState<DistillJob[]>([]);
  const [error, setError] = useState("");
  const loadingPersonaIdsRef = useRef(new Set<string>());

  const selected = useMemo(
    () => personas.find((persona) => persona.id === selectedId) || personas[0],
    [personas, selectedId]
  );
  const activeRuntime = selected?.id ? runtimes[selected.id] || createEmptyRuntime() : createEmptyRuntime();
  const streamingPersonaIds = useMemo(
    () => new Set(Object.entries(runtimes).filter(([, runtime]) => runtime.streaming).map(([id]) => id)),
    [runtimes]
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selected?.id) return;
    if (!runtimes[selected.id]?.chat) {
      void startChat(selected.id);
    }
  }, [selected?.id]);

  useEffect(() => {
    const activeJobs = distillJobs.filter((job) => job.status === "queued" || job.status === "running");
    if (!activeJobs.length) return;

    const timer = window.setInterval(() => {
      activeJobs.forEach((job) => {
        void pollDistillJob(job.id);
      });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [distillJobs]);

  async function bootstrap() {
    try {
      const [nextConfig, nextPersonas] = await Promise.all([getConfig(), getPersonas()]);
      setConfig(nextConfig);
      setPersonas(nextPersonas);
      setSelectedId(nextPersonas[0]?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "启动失败");
    }
  }

  async function startChat(personaId: string) {
    if (loadingPersonaIdsRef.current.has(personaId)) return;
    loadingPersonaIdsRef.current.add(personaId);
    try {
      setError("");
      patchRuntime(personaId, (runtime) => ({
        ...runtime,
        status: "正在载入历史...",
        error: ""
      }));
      const nextChat = await createChat(personaId, true);
      const history = await getChatHistory(personaId);
      patchRuntime(personaId, (runtime) => ({
        ...runtime,
        chat: nextChat,
        chatHistory: history,
        messages: nextChat.messages,
        sources: [],
        status: ""
      }));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "无法创建会话";
      patchRuntime(personaId, (runtime) => ({ ...runtime, status: "", error: message }));
    } finally {
      loadingPersonaIdsRef.current.delete(personaId);
    }
  }

  async function refreshChatHistory(personaId = selected?.id) {
    if (!personaId) return;
    const history = await getChatHistory(personaId);
    patchRuntime(personaId, (runtime) => ({ ...runtime, chatHistory: history }));
  }

  async function handleSelectChat(chatId: string) {
    if (!selected?.id || !chatId || activeRuntime.chat?.id === chatId) return;
    const personaId = selected.id;
    try {
      setError("");
      patchRuntime(personaId, (runtime) => ({ ...runtime, status: "正在载入历史...", error: "", sources: [] }));
      const nextChat = await getChat(chatId);
      patchRuntime(personaId, (runtime) => ({
        ...runtime,
        chat: nextChat,
        messages: nextChat.messages,
        status: ""
      }));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "无法载入历史对话";
      patchRuntime(personaId, (runtime) => ({ ...runtime, status: "", error: message }));
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!selected?.id) return;
    const personaId = selected.id;
    const runtime = runtimes[personaId] || createEmptyRuntime();
    const chat = runtime.chat;
    if (!chat || !runtime.input.trim() || runtime.streaming) return;

    const content = runtime.input.trim();

    const localUser: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };
    const localAssistant: ChatMessage = {
      id: `stream-${Date.now()}`,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    };
    patchRuntime(personaId, (current) => ({
      ...current,
      input: "",
      streaming: true,
      error: "",
      status: "正在发送...",
      messages: [...current.messages, localUser, localAssistant]
    }));

    try {
      await sendMessageStream(
        chat.id,
        { content, forceResearch: runtime.forceResearch },
        (eventMessage) => {
          if (eventMessage.type === "status") {
            patchRuntime(personaId, (current) => ({ ...current, status: eventMessage.message }));
          }
          if (eventMessage.type === "sources") {
            patchRuntime(personaId, (current) => ({ ...current, sources: eventMessage.sources }));
          }
          if (eventMessage.type === "research-error") {
            patchRuntime(personaId, (current) => ({ ...current, status: eventMessage.message }));
          }
          if (eventMessage.type === "delta") {
            patchRuntime(personaId, (current) => ({
              ...current,
              messages: current.messages.map((message) =>
                message.id === localAssistant.id ? { ...message, content: message.content + eventMessage.delta } : message
              )
            }));
          }
          if (eventMessage.type === "error") {
            patchRuntime(personaId, (current) => ({
              ...current,
              error: eventMessage.message,
              messages: current.messages.map((message) =>
                message.id === localAssistant.id
                  ? { ...message, content: `（未能生成回复：${eventMessage.message}）` }
                  : message
              )
            }));
          }
          if (eventMessage.type === "done") {
            patchRuntime(personaId, (current) => ({
              ...current,
              messages: current.messages.map((message) =>
                message.id === localAssistant.id ? eventMessage.message : message
              )
            }));
            void refreshChatHistory(chat.personaId);
          }
        }
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "发送失败";
      patchRuntime(personaId, (current) => ({
        ...current,
        error: message,
        messages: current.messages.map((item) =>
          item.id === localAssistant.id ? { ...item, content: `（未能生成回复：${message}）` } : item
        )
      }));
    } finally {
      patchRuntime(personaId, (current) => ({ ...current, streaming: false, status: "" }));
    }
  }

  async function handleManualResearch() {
    if (!selected?.id) return;
    const personaId = selected.id;
    const runtime = runtimes[personaId] || createEmptyRuntime();
    if (!runtime.input.trim() || !config?.researchConfigured) return;
    patchRuntime(personaId, (current) => ({ ...current, status: "正在查当下资料...", error: "" }));
    setError("");
    try {
      const result = await runResearch(runtime.input.trim());
      patchRuntime(personaId, (current) => ({ ...current, sources: result.sources, status: "检索完成" }));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "检索失败";
      patchRuntime(personaId, (current) => ({ ...current, error: message, status: "" }));
    }
  }

  async function refreshPersonas(nextId?: string) {
    const nextPersonas = await getPersonas();
    setPersonas(nextPersonas);
    if (nextId) setSelectedId(nextId);
  }

  async function pollDistillJob(jobId: string) {
    try {
      const nextJob = await getDistillJob(jobId);
      upsertDistillJob(nextJob);
      if (nextJob.status === "done") {
        await refreshPersonas();
      }
    } catch {
      // Keep the last known status; the next polling tick may recover.
    }
  }

  function upsertDistillJob(job: DistillJob) {
    setDistillJobs((current) => {
      const exists = current.some((item) => item.id === job.id);
      const next = exists ? current.map((item) => (item.id === job.id ? job : item)) : [job, ...current];
      return next.slice(0, 5);
    });
  }

  async function handleNewChat() {
    if (!selected?.id) return;
    const personaId = selected.id;
    try {
      setError("");
      patchRuntime(personaId, (runtime) => ({ ...runtime, status: "", sources: [], error: "" }));
      const nextChat = await createChat(personaId, false);
      const history = await getChatHistory(personaId);
      patchRuntime(personaId, (runtime) => ({
        ...runtime,
        chat: nextChat,
        chatHistory: history,
        messages: [],
        sources: [],
        status: ""
      }));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "无法创建新对话";
      patchRuntime(personaId, (runtime) => ({ ...runtime, error: message }));
    }
  }

  function patchRuntime(personaId: string, updater: (runtime: PersonaRuntime) => PersonaRuntime) {
    setRuntimes((current) => ({
      ...current,
      [personaId]: updater(current[personaId] || createEmptyRuntime())
    }));
  }

  return (
    <>
      {booting && <IntroLoader ready={personas.length > 0 || Boolean(error)} onDone={() => setBooting(false)} />}
      <main className="app-shell" aria-busy={booting}>
        <PersonaSidebar
          personas={personas}
          selectedId={selected?.id || ""}
          streamingPersonaIds={streamingPersonaIds}
          onSelect={setSelectedId}
          onOpenDistill={() => setDistillOpen(true)}
        />
        <section className="conversation-shell">
          <TopBar
            persona={selected}
            config={config}
            onOpenDistill={() => setDistillOpen(true)}
            onNewChat={handleNewChat}
            chatHistory={activeRuntime.chatHistory}
            currentChatId={activeRuntime.chat?.id || ""}
            onSelectChat={handleSelectChat}
          />
          <div className="notice-stack">
            {(error || activeRuntime.error) && (
              <div className="notice notice--error">
                <AlertCircle size={16} />
                <span>{activeRuntime.error || error}</span>
              </div>
            )}
            {!config?.chatConfigured && (
              <div className="notice">
                <AlertCircle size={16} />
                <span>未检测到 LONGCAT_API_KEY。界面可用，实时聊天和蒸馏需在 .env 配置密钥后重启。</span>
              </div>
            )}
          </div>
          <MessagePane messages={activeRuntime.messages} persona={selected} streaming={activeRuntime.streaming} />
          <DistillJobTray jobs={distillJobs} />
          <Composer
            input={activeRuntime.input}
            setInput={(value) => selected?.id && patchRuntime(selected.id, (runtime) => ({ ...runtime, input: value }))}
            onSend={handleSend}
            onResearch={handleManualResearch}
            forceResearch={activeRuntime.forceResearch}
            setForceResearch={(value) =>
              selected?.id && patchRuntime(selected.id, (runtime) => ({ ...runtime, forceResearch: value }))
            }
            status={activeRuntime.status}
            streaming={activeRuntime.streaming}
            researchConfigured={Boolean(config?.researchConfigured)}
          />
        </section>
        <InsightPanel persona={selected} sources={activeRuntime.sources} />
      </main>
      {distillOpen && (
        <DistillDialog
          onClose={() => setDistillOpen(false)}
          onStarted={(job) => {
            upsertDistillJob(job);
            setDistillOpen(false);
          }}
          chatConfigured={Boolean(config?.chatConfigured)}
          researchConfigured={Boolean(config?.researchConfigured)}
        />
      )}
    </>
  );
}

function PersonaSidebar({
  personas,
  selectedId,
  streamingPersonaIds,
  onSelect,
  onOpenDistill
}: {
  personas: Persona[];
  selectedId: string;
  streamingPersonaIds: Set<string>;
  onSelect: (id: string) => void;
  onOpenDistill: () => void;
}) {
  return (
    <aside className="sidebar">
      <button className="distill-button" type="button" onClick={onOpenDistill}>
        <Sparkles size={17} />
        造一个新人物
      </button>
      <div className="persona-list">
        {personas.map((persona) => (
          <button
            className={`persona-card ${selectedId === persona.id ? "persona-card--active" : ""}`}
            key={persona.id}
            type="button"
            style={{ "--accent": persona.accent } as React.CSSProperties}
            onClick={() => onSelect(persona.id)}
          >
            <PersonaAvatar persona={persona} streaming={streamingPersonaIds.has(persona.id)} />
            <span>
              <strong>{persona.displayName}</strong>
              <small>{persona.isCustom ? "自定义蒸馏" : persona.skillName}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function PersonaAvatar({ persona, streaming }: { persona: Persona; streaming: boolean }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={`persona-avatar ${streaming ? "persona-avatar--streaming" : ""}`}>
      {persona.avatarUrl && !failed ? (
        <img src={persona.avatarUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <SketchAvatar name={persona.displayName} />
      )}
    </span>
  );
}

function SketchAvatar({ name }: { name: string }) {
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const browTilt = seed % 2 === 0 ? "M17 25 Q24 22 31 24" : "M17 24 Q24 25 31 23";
  const mouth = seed % 3 === 0 ? "M24 43 Q32 47 40 43" : seed % 3 === 1 ? "M25 44 Q32 42 39 44" : "M25 43 L39 43";
  const hair = seed % 4;

  return (
    <svg className="persona-avatar-sketch" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" fill="#e8e2d6" opacity="0.05" />
      {hair === 0 && <path d="M16 25 Q20 8 35 10 Q47 12 50 29 Q42 18 31 17 Q22 17 16 25Z" />}
      {hair === 1 && <path d="M15 27 Q18 12 31 9 Q45 10 51 24 Q41 21 33 18 Q24 21 15 27Z" />}
      {hair === 2 && <path d="M17 23 Q27 6 43 14 Q51 20 48 34 Q44 24 34 20 Q24 19 17 23Z" />}
      {hair === 3 && <path d="M16 24 Q19 11 32 10 Q46 11 50 25 Q38 18 28 18 Q21 19 16 24Z" />}
      <path d="M18 30 Q19 17 32 15 Q45 17 46 31 L44 42 Q41 54 32 55 Q23 54 20 42Z" />
      <path d={browTilt} />
      <path d="M35 24 Q41 22 47 25" />
      <path d="M23 30 Q25 29 27 30" />
      <path d="M38 30 Q40 29 42 30" />
      <path d="M32 30 Q30 36 33 38" />
      <path d={mouth} />
      <path d="M21 55 Q32 60 43 55" />
      <path d="M13 61 Q20 53 29 53" />
      <path d="M51 61 Q44 53 35 53" />
    </svg>
  );
}

function TopBar({
  persona,
  config,
  onOpenDistill,
  onNewChat,
  chatHistory,
  currentChatId,
  onSelectChat
}: {
  persona?: Persona;
  config: ClientConfig | null;
  onOpenDistill: () => void;
  onNewChat: () => void;
  chatHistory: ChatSummary[];
  currentChatId: string;
  onSelectChat: (chatId: string) => void;
}) {
  const researchLabel =
    config?.researchProvider === "doubao" ? "豆包搜索" : config?.researchProvider === "firecrawl" ? "Firecrawl" : "搜索";

  return (
    <header className="topbar">
      <div>
        <p>AI 蒸馏模拟 · 非本人</p>
        <h1>{persona?.title || "载入人物中"}</h1>
      </div>
      <div className="topbar-actions">
        <span className={config?.researchConfigured ? "pill pill--ok" : "pill"}>
          {config?.researchConfigured ? <Check size={14} /> : <AlertCircle size={14} />}
          {researchLabel}
        </span>
        <span className={config?.chatConfigured ? "pill pill--ok" : "pill"}>
          {config?.chatConfigured ? <Check size={14} /> : <AlertCircle size={14} />}
          {config?.model || "LongCat"}
        </span>
        <button className="icon-text-button" type="button" onClick={onOpenDistill}>
          <Plus size={16} />
          蒸馏
        </button>
        <button className="icon-text-button" type="button" onClick={onNewChat}>
          <FilePlus2 size={16} />
          新对话
        </button>
        <select
          className="history-select"
          value={currentChatId}
          onChange={(event) => onSelectChat(event.target.value)}
          aria-label="历史对话"
        >
          {chatHistory.length ? (
            chatHistory.map((item) => (
              <option key={item.id} value={item.id}>
                {formatHistoryLabel(item)}
              </option>
            ))
          ) : (
            <option value="">暂无历史</option>
          )}
        </select>
      </div>
    </header>
  );
}

function formatHistoryLabel(item: ChatSummary): string {
  const time = new Date(item.updatedAt);
  const date = Number.isNaN(time.getTime())
    ? "历史"
    : `${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")} ${String(
        time.getHours()
      ).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  const preview = item.preview.replace(/\s+/g, " ").slice(0, 18);
  return `${date} · ${item.messageCount}条 · ${preview}`;
}

function MessagePane({
  messages,
  persona,
  streaming
}: {
  messages: ChatMessage[];
  persona?: Persona;
  streaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="message-pane">
      {messages.length === 0 && (
        <div className="empty-state">
          <BrainCircuit size={36} />
          <h2>和 {persona?.displayName || "一个人物"} 开始对话</h2>
          <p>
            这是一场基于公开资料和蒸馏 skill 的 AI 模拟。你可以提具体问题，也可以让对方从自己的思维框架审视你的困境。
          </p>
        </div>
      )}
      {messages.map((message) => (
        <article className={`message message--${message.role}`} key={message.id}>
          <div className="message-role">{message.role === "user" ? "你" : persona?.displayName || "AI"}</div>
          <div className="message-content">
            {message.role === "assistant" ? (
              <MarkdownText text={message.content || (streaming ? "..." : "")} />
            ) : (
              message.content || (streaming ? "..." : "")
            )}
          </div>
        </article>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function Composer({
  input,
  setInput,
  onSend,
  onResearch,
  forceResearch,
  setForceResearch,
  status,
  streaming,
  researchConfigured
}: {
  input: string;
  setInput: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onResearch: () => void;
  forceResearch: boolean;
  setForceResearch: (value: boolean) => void;
  status: string;
  streaming: boolean;
  researchConfigured: boolean;
}) {
  return (
    <form className="composer" onSubmit={onSend}>
      <div className="composer-tools">
        <button
          className={`tool-button ${forceResearch ? "tool-button--active" : ""}`}
          type="button"
          onClick={() => setForceResearch(!forceResearch)}
          title="发送前查当下资料"
          disabled={!researchConfigured}
        >
          <Search size={16} />
          查当下
        </button>
        <button
          className="tool-button"
          type="button"
          onClick={onResearch}
          title="只检索不发送"
          disabled={!input.trim() || !researchConfigured}
        >
          <BookOpen size={16} />
          预检索
        </button>
        <span className="composer-status">{status}</span>
      </div>
      <div className="composer-input-row">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="把你的问题、决策或困境交给这个思维框架..."
          rows={2}
        />
        <button className="send-button" type="submit" disabled={!input.trim() || streaming} title="发送">
          {streaming ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
        </button>
      </div>
    </form>
  );
}

function InsightPanel({ persona, sources }: { persona?: Persona; sources: ResearchSource[] }) {
  return (
    <aside className="insight-panel">
      <section>
        <div className="panel-heading">
          <BrainCircuit size={17} />
          <h2>思维模型</h2>
        </div>
        <MarkdownText text={persona?.sections.models || "这个 skill 没有可自动摘取的模型片段，聊天时会读取完整 Markdown。"} />
      </section>
      <section>
        <div className="panel-heading">
          <AlertCircle size={17} />
          <h2>诚实边界</h2>
        </div>
        <MarkdownText text={persona?.sections.honesty || "对话会保持 AI 蒸馏模拟边界，不声称真人本人在线。"} />
      </section>
      <section>
        <div className="panel-heading">
          <MessageSquareText size={17} />
          <h2>当下来源</h2>
        </div>
        {sources.length ? (
          <div className="source-list">
            {sources.map((source) => (
              <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                <strong>{source.title}</strong>
                <span>{source.description || source.url}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">遇到最新事实问题时，打开“查当下”会在这里显示来源。</p>
        )}
      </section>
    </aside>
  );
}

function DistillJobTray({ jobs }: { jobs: DistillJob[] }) {
  if (!jobs.length) return null;

  return (
    <div className="distill-job-tray" aria-live="polite">
      {jobs.map((job) => (
        <div className={`distill-job distill-job--${job.status}`} key={job.id}>
          {job.status === "done" ? <Check size={16} /> : job.status === "error" ? <AlertCircle size={16} /> : <Loader2 className="spin" size={16} />}
          <span>
            <strong>{job.personName}</strong>
            <small>{job.message || statusLabel(job.status)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function statusLabel(status: DistillJob["status"]): string {
  if (status === "queued") return "等待后台蒸馏";
  if (status === "running") return "后台蒸馏中";
  if (status === "done") return "已加入人物库";
  return "蒸馏失败";
}

function DistillDialog({
  onClose,
  onStarted,
  chatConfigured,
  researchConfigured
}: {
  onClose: () => void;
  onStarted: (job: DistillJob) => void;
  chatConfigured: boolean;
  researchConfigured: boolean;
}) {
  const [personName, setPersonName] = useState("");
  const [purpose, setPurpose] = useState("作为思维顾问，与用户深度交流");
  const [materials, setMaterials] = useState("");
  const [depth, setDepth] = useState<"standard" | "quick">("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!personName.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const job = await distillPersona({ personName, purpose, materials, depth });
      onStarted(job);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "蒸馏失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="distill-dialog" onSubmit={submit}>
        <button className="dialog-close" type="button" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        <Sparkles size={28} />
        <h2>蒸馏一个新人物</h2>
        <p>
          默认使用标准女娲流水线：6 维调研、框架提炼、Skill 构建、质量审校和一次精炼。提交后会转入后台，你可以继续聊天。
        </p>
        {!chatConfigured && <div className="notice">需要配置 LONGCAT_API_KEY 才能生成新 skill。</div>}
        {!researchConfigured && <div className="notice">未配置搜索密钥，标准档会退化为仅基于用户资料的蒸馏。</div>}
        <div className="distill-depth" role="radiogroup" aria-label="蒸馏档位">
          <button
            className={depth === "standard" ? "distill-depth-option distill-depth-option--active" : "distill-depth-option"}
            type="button"
            onClick={() => setDepth("standard")}
            aria-pressed={depth === "standard"}
          >
            <strong>标准女娲</strong>
            <span>6 维调研 + synthesis + 质量审校</span>
          </button>
          <button
            className={depth === "quick" ? "distill-depth-option distill-depth-option--active" : "distill-depth-option"}
            type="button"
            onClick={() => setDepth("quick")}
            aria-pressed={depth === "quick"}
          >
            <strong>快速预览</strong>
            <span>一次搜索 + 一次生成，适合先试</span>
          </button>
        </div>
        <label>
          人物
          <input value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="例如：王小波" />
        </label>
        <label>
          用途
          <input value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
        <label>
          本地资料或说明
          <textarea
            value={materials}
            onChange={(event) => setMaterials(event.target.value)}
            rows={6}
            placeholder="粘贴访谈、文章片段、来源线索或你希望强调的维度。"
          />
        </label>
        {error && <div className="notice notice--error">{error}</div>}
        <button className="primary-button" type="submit" disabled={!personName.trim() || busy || !chatConfigured}>
          {busy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {busy ? "正在提交后台任务..." : "开始后台蒸馏"}
        </button>
      </form>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);

  return (
    <div className="markdown-body">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          return <h3 key={key}>{renderInlineMarkdown(block.text)}</h3>;
        }
        if (block.type === "list") {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const listItem = line.match(/^\s*[-*]\s+(.+)$/);

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }

    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ type: "paragraph", text }];
}

function renderInlineMarkdown(text: string) {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${match.index}-${token}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={`${match.index}-${token}`}>{token.slice(1, -1)}</code>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}
