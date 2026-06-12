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
  const res = await fetch(`${INGEST_URL}/documents`, {
    method: "POST",
    body: fd,
  });
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

export const ingestUrl = INGEST_URL;
