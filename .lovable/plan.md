
# Personal Assistant — v1: Document Ingestion

Since Ollama and ChromaDB run on the user's machine, and the Lovable-hosted webapp can't reach `localhost` from a hosted HTTPS preview, v1 ships as **two pieces**: a React webapp (UI) + a **Docker Compose stack** the user runs locally (Chroma + a small ingest sidecar). The webapp talks to the sidecar over HTTP. When this later becomes a Tauri app, the same sidecar is bundled or replaced with Rust calls — no UI rewrite.

## Scope (v1)

- Drag-and-drop upload for **pdf, docx, doc, txt, html, md**
- Server-side parse → chunk → embed (Chroma's default `all-MiniLM-L6-v2`) → store in Chroma
- Document library: list ingested docs, view chunk count, delete, re-index
- No chat / no auth yet (single-user, local)

## Architecture

```text
┌─────────────────────┐    HTTP     ┌──────────────────────┐
│  React webapp       │ ──────────▶ │  ingest-api (sidecar)│
│  (Lovable / Tauri)  │             │  FastAPI :8080       │
└─────────────────────┘             │  - parse             │
                                    │  - chunk             │
                                    │  - embed + upsert    │
                                    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │  chromadb :8000      │
                                    │  (persistent volume) │
                                    └──────────────────────┘
```

Both run via `docker compose up`. Webapp config takes a single env var: `VITE_INGEST_URL` (default `http://localhost:8080`).

## Repo layout additions

```text
docker/
  docker-compose.yml          # chroma + ingest-api
  ingest-api/
    Dockerfile
    requirements.txt          # fastapi, uvicorn, chromadb-client,
                              # pypdf, python-docx, beautifulsoup4,
                              # markdown-it-py, python-multipart
    main.py                   # endpoints below
    parsers.py                # one parser per file type
    chunker.py                # ~800-char chunks, 100 overlap
src/
  routes/
    index.tsx                 # redirect to /documents
    documents.tsx             # library + upload UI
  lib/ingest-client.ts        # typed fetch wrapper around sidecar
  components/
    DocumentUploader.tsx      # drag-drop, progress
    DocumentList.tsx          # table of ingested docs
README.md                     # how to run the stack
```

## Sidecar API (FastAPI)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/health` | liveness + chroma reachability |
| `POST` | `/documents` | multipart upload → parse, chunk, embed, upsert. Returns `{id, name, chunks}` |
| `GET`  | `/documents` | list distinct source docs (group by metadata.doc_id) |
| `DELETE` | `/documents/{id}` | delete all chunks where metadata.doc_id matches |
| `POST` | `/search` *(stub for v2)* | placeholder for tool-call retrieval later |

CORS open to `*` for local use. Collection name: `documents`. Chroma uses its bundled embedding function so no API keys, no GPU required — runs CPU-only.

Parsers:
- `.pdf` → `pypdf`
- `.docx` → `python-docx`
- `.doc` → reject in v1 with a clear error (needs LibreOffice); add later
- `.html` → `beautifulsoup4` (strip scripts/styles, get text)
- `.md` → `markdown-it-py` → strip to text
- `.txt` → read as-is

Chunking: recursive char splitter, 800 chars, 100 overlap. Each chunk stored with metadata `{doc_id, source_name, mime, chunk_index, total_chunks, ingested_at}`.

## Webapp

- TanStack Start route `/documents` is the home (index redirects there).
- `DocumentUploader`: drag-drop zone, file list with per-file progress and status (queued / parsing / embedding / done / error). Posts each file individually so big PDFs don't block others.
- `DocumentList`: table of `{name, chunks, ingested_at, actions: delete / re-index}`. Re-index = delete + re-upload (user picks file again in v1).
- A status banner at the top pings `/health` and shows "Sidecar offline — run `docker compose up` in the project's `docker/` folder" with a copy button when unreachable.
- Pure shadcn/Tailwind, no backend secrets, no Lovable Cloud needed for v1.

## Running it (added to README)

```bash
cd docker
docker compose up -d
# webapp: bun dev, opens http://localhost:5173
```

Chroma data persisted in a named volume `chroma-data` so restarts keep documents.

## What this sets up for v2 (not built now)

- `/search` endpoint already stubbed — wire to Chroma `query` later
- Ollama service can be added to the same compose file
- Chat UI + tool-calling agent (`search_documents`) becomes a new route, leaves ingestion untouched
- Tauri shell: replace `VITE_INGEST_URL` with bundled sidecar binary or in-process Rust

## Open assumptions (will proceed unless you object)

1. **Chroma's default embedder** (MiniLM, 384-dim, English-focused) is fine for v1. Swap is one line in the sidecar later.
2. **No auth, single-user, local-only.** No data leaves the machine.
3. **`.doc` (legacy Word)** is out of scope for v1 — error with a helpful message.
4. Webapp runs in dev locally too (since Chroma is on localhost). The Lovable hosted preview will show the "sidecar offline" banner, which is expected.
