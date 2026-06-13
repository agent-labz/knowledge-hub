/**
 * Typed client for the local ingest sidecar (FastAPI, default :8080).
 * The sidecar runs in Docker on the user's machine.
 */
const INGEST_URL =
  (import.meta.env.VITE_INGEST_URL as string | undefined) ?? "http://localhost:8080";

export interface IngestedDocument {
  id: string;
  name: string;
  mime?: string;
  chunks: number;
  ingested_at?: string;
}

export interface UploadResult extends IngestedDocument {}

export interface WebSearchResult {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  score?: number;
  published_date?: string;
}

export interface WebSearchResponse {
  query: string;
  count: number;
  results: WebSearchResult[];
  answers: string[];
  suggestions: string[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${INGEST_URL}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pingWebSearch(): Promise<boolean> {
  try {
    const res = await fetch(`${INGEST_URL}/search/web/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function uploadDocument(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${INGEST_URL}/documents`, { method: "POST", body: fd });
  return jsonOrThrow<UploadResult>(res);
}

export async function listDocuments(): Promise<IngestedDocument[]> {
  const res = await fetch(`${INGEST_URL}/documents`);
  const body = await jsonOrThrow<{ documents: IngestedDocument[] }>(res);
  return body.documents;
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${INGEST_URL}/documents/${id}`, { method: "DELETE" });
  await jsonOrThrow(res);
}

export async function webSearch(
  query: string,
  opts: { maxResults?: number; categories?: string; timeRange?: string } = {},
): Promise<WebSearchResponse> {
  const res = await fetch(`${INGEST_URL}/search/web`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: opts.maxResults ?? 10,
      categories: opts.categories,
      time_range: opts.timeRange,
    }),
  });
  return jsonOrThrow<WebSearchResponse>(res);
}

// ─── Chat ────────────────────────────────────────────────────────────────

export interface ChatToolCall {
  function?: { name: string; arguments: unknown };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ChatToolCall[];
  name?: string;
}

export interface ModelsResponse {
  models: string[];
  default: string;
}

export async function listModels(): Promise<ModelsResponse> {
  const res = await fetch(`${INGEST_URL}/chat/models`);
  return jsonOrThrow<ModelsResponse>(res);
}

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * POST /chat and parse the SSE stream. Calls onEvent for each event.
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: { model?: string; signal?: AbortSignal; onEvent: (e: ChatStreamEvent) => void },
): Promise<void> {
  const res = await fetch(`${INGEST_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: opts.model }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(detail || `${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE messages are separated by blank lines
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      switch (event) {
        case "token":
          opts.onEvent({ type: "token", text: String(parsed.text ?? "") });
          break;
        case "tool_call":
          opts.onEvent({
            type: "tool_call",
            name: String(parsed.name ?? ""),
            arguments: (parsed.arguments as Record<string, unknown>) ?? {},
          });
          break;
        case "tool_result":
          opts.onEvent({
            type: "tool_result",
            name: String(parsed.name ?? ""),
            result: parsed.result,
          });
          break;
        case "done":
          opts.onEvent({ type: "done" });
          break;
        case "error":
          opts.onEvent({ type: "error", message: String(parsed.message ?? "Unknown error") });
          break;
      }
    }
  }
}

export const ingestUrl = INGEST_URL;
