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

export const ingestUrl = INGEST_URL;
