const DEFAULT_LONGCAT_BASE_URL = "https://api.longcat.chat/openai/v1";
const DEFAULT_MODEL = "LongCat-2.0";

export function getModelName(): string {
  return process.env.LONGCAT_MODEL || DEFAULT_MODEL;
}

export function isChatConfigured(): boolean {
  return Boolean(process.env.LONGCAT_API_KEY);
}

export async function completeChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const response = await fetch(completionsUrl(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: getModelName(),
      messages,
      temperature: options.temperature ?? 0.82,
      max_tokens: options.maxTokens ?? 2800,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`LongCat request failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return json.choices?.[0]?.message?.content?.trim() || "";
}

export async function streamChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onDelta: (delta: string) => void
): Promise<string> {
  const response = await fetch(completionsUrl(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: getModelName(),
      messages,
      temperature: 0.86,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`LongCat stream failed: ${response.status} ${await response.text()}`);
  }

  if (!response.body) {
    throw new Error("LongCat stream did not return a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || "";
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      } catch {
        // Ignore malformed keepalive chunks from OpenAI-compatible providers.
      }
    }
  }

  return fullText.trim();
}

function headers(): Record<string, string> {
  if (!process.env.LONGCAT_API_KEY) {
    throw new Error("LONGCAT_API_KEY is not configured.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LONGCAT_API_KEY}`
  };
}

function completionsUrl(): string {
  const raw = process.env.LONGCAT_BASE_URL || DEFAULT_LONGCAT_BASE_URL;
  const base = raw.replace(/\/+$/, "");
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}
