# Personal Assistant

A local-first personal assistant that ingests your documents into a vector database and searches the web through your own SearXNG, so an AI agent (v2) can use both as tools.

## Services

| Service | Purpose | Port |
|---|---|---|
| **chromadb** | Vector store for embedded document chunks | `:8000` |
| **searxng** | Privacy-respecting metasearch (Google, Bing, DDG, Wikipedia, GitHub…) | `:8888` |
| **ollama** | Local LLM runtime — powers the chat agent | `:11434` |
| **ingest-api** | FastAPI sidecar: parses files, embeds into Chroma, proxies web search, runs the chat tool loop | `:8080` |

The webapp talks to `ingest-api` only — it never reaches Chroma, SearXNG, or Ollama directly.

### Pull a model

After `docker compose up -d`, pull a chat model into Ollama (one-time, ~2 GB):

```bash
docker exec assistant-ollama ollama pull llama3.2:3b
```

Override the default with `DEFAULT_MODEL=phi4:mini docker compose up -d` etc.

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
| `POST` | `/search` | RAG search over Chroma |
| `GET`  | `/search/web/health` | SearXNG liveness |
| `POST` | `/search/web` | web search via SearXNG (JSON) |
| `GET`  | `/chat/models` | list locally-pulled Ollama models |
| `POST` | `/chat` | SSE stream — runs the tool-calling loop (`search_documents`, `web_search`) and streams the final answer |

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
| `OLLAMA_URL` | ingest-api | `http://ollama:11434` | Internal sidecar→Ollama URL |
| `DEFAULT_MODEL` | ingest-api | `llama3.2:3b` | Model used when chat request omits one |

SearXNG config: `docker/searxng/settings.yml`.

## v3 (next)

- Persistent chat history
- Tauri shell bundling all four services
- Multi-modal (images, audio)

## File support notes

- `.doc` (legacy Word) — not supported. Convert to `.docx` first.
- Scanned PDFs without an OCR layer ingest as empty text.
