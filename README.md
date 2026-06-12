# Personal Assistant

A local-first personal assistant that ingests your documents into a vector database and searches the web through your own SearXNG, so an AI agent (v2) can use both as tools.

## v1 services

| Service | Purpose | Port |
|---|---|---|
| **chromadb** | Vector store for embedded document chunks | `:8000` |
| **searxng** | Privacy-respecting metasearch (Google, Bing, DDG, Wikipedia, GitHub…) | `:8888` |
| **ingest-api** | FastAPI sidecar: parses files, chunks, embeds into Chroma, proxies web search | `:8080` |

The webapp talks to `ingest-api` only — it never reaches Chroma or SearXNG directly.

## Running it

**Prereqs:** Docker + Docker Compose, Bun (or Node).

### 1. Start the backend stack

```bash
cd docker
# Optional: set your own SearXNG secret (defaults to a placeholder)
export SEARXNG_SECRET="$(openssl rand -hex 32)"
docker compose up -d
```

This starts Chroma, SearXNG, and the ingest API. First start of SearXNG can take ~30s.

Health checks:
```bash
curl http://localhost:8080/health             # ingest + chroma
curl http://localhost:8080/search/web/health  # searxng
```

SearXNG's own UI is at <http://localhost:8888>.

### 2. Start the webapp

```bash
bun install
bun dev
```

Open <http://localhost:5173>. Two tabs:
- **Documents** — drag-drop ingest, library view
- **Web search** — query SearXNG, see ranked results

### Stopping / resetting

```bash
cd docker
docker compose down              # stop, keep data
docker compose down -v           # also wipe chroma-data volume
```

## API surface (ingest-api on `:8080`)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | ingest + chroma liveness |
| `POST` | `/documents` | upload + ingest a file |
| `GET`  | `/documents` | list ingested documents |
| `DELETE` | `/documents/{id}` | delete all chunks for a doc |
| `POST` | `/search` | stub — RAG over Chroma (v2) |
| `GET`  | `/search/web/health` | SearXNG liveness |
| `POST` | `/search/web` | web search via SearXNG (JSON) |

`POST /search/web` body:
```json
{ "query": "rust async runtime", "max_results": 10, "time_range": "month" }
```

## Configuration

| Variable | Where | Default | What it does |
|---|---|---|---|
| `VITE_INGEST_URL` | webapp | `http://localhost:8080` | Ingest API URL |
| `SEARXNG_SECRET` | compose | placeholder | Secret key for SearXNG sessions — set your own |
| `SEARXNG_URL` | ingest-api | `http://searxng:8080` | Internal sidecar→SearXNG URL |

SearXNG config: `docker/searxng/settings.yml` (JSON format is enabled — required for the API). Tweak engines or `safe_search` there.

## v2 (next)

- Add **Ollama** to the same compose stack
- Chat UI with an agent that has two tools: `search_documents` (Chroma) and `search_web` (SearXNG)
- Tauri shell bundling all four services

## File support notes

- `.doc` (legacy Word) — not supported. Convert to `.docx` first.
- Scanned PDFs without an OCR layer ingest as empty text.
