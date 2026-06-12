# Personal Assistant

A local-first personal assistant that ingests your documents into a vector database so an AI agent can search them (v2). Built as a webapp now, designed to ship as a Tauri desktop app later.

## v1: Document Ingestion

Upload **PDF, DOCX, TXT, HTML, or Markdown** files. They're parsed, chunked, embedded with a local model, and stored in a Dockerized ChromaDB on your machine. Nothing leaves localhost.

## Architecture

```
React webapp  ──HTTP──▶  ingest-api (FastAPI, :8080)  ──▶  ChromaDB (:8000)
```

Both backend pieces run in Docker via `docker compose`.

## Running it

**Prereqs:** Docker + Docker Compose, Bun (or Node).

### 1. Start the backend stack

```bash
cd docker
docker compose up -d
```

This starts:
- `chromadb` on `http://localhost:8000` (persistent volume `chroma-data`)
- `ingest-api` on `http://localhost:8080`

Check it's healthy:
```bash
curl http://localhost:8080/health
```

### 2. Start the webapp

```bash
bun install
bun dev
```

Open <http://localhost:5173>. The header shows a green "Sidecar online" badge once it can reach the API. Drag files into the upload zone; they'll appear in the library below once ingested.

### Stopping / resetting

```bash
cd docker
docker compose down              # stop containers, keep data
docker compose down -v           # also wipe the chroma-data volume
```

## Configuration

The webapp reads one env var:

| Variable | Default | What it does |
|---|---|---|
| `VITE_INGEST_URL` | `http://localhost:8080` | Where to reach the ingest sidecar |

## What's next (v2)

- Local **Ollama** added to the same compose stack
- Chat UI with an agent that calls a `search_documents` tool against Chroma
- Tauri shell bundling the sidecar as a native binary

## File support notes

- `.doc` (legacy Word) — not supported in v1. Convert to `.docx` first.
- Scanned PDFs without an OCR layer will ingest as empty text.
