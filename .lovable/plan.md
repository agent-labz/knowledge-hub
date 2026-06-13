# Personal Assistant — v2: Chat Agent with Tools

## Goal
Add a local Ollama-powered chat interface that can query your document library and the web via tool calls.

## Architecture

```text
┌─────────────────────┐     HTTP      ┌──────────────────────┐
│  React webapp       │  ──────────▶  │  ingest-api (sidecar)│
│  (Lovable / Tauri)  │               │  FastAPI :8080        │
│                     │               │  - parse / chunk / embed│
│  ┌───────────────┐  │               │  - /chat → proxy Ollama│
│  │ /chat route   │  │               │    with tool calling    │
│  │ - message list│  │               │  - /search (doc RAG)  │
│  │ - input box   │  │               │  - /search/web (SearX)│
│  └───────────────┘  │               └──────────┬────────────┘
└─────────────────────┘                          │
                                                 │
                    ┌────────────────────────────┼────────────────┐
                    │                            │                │
                    ▼                            ▼                ▼
            ┌──────────────┐          ┌──────────────┐   ┌─────────────┐
            │ chromadb:8000│          │ searxng:8888 │   │ ollama:11434│
            │ (documents)  │          │ (web search) │   │ (LLM)       │
            └──────────────┘          └──────────────┘   └─────────────┘
```

## What gets built

### 1. Docker Compose — add Ollama service
- `ollama` container on `:11434`, volume `ollama-data` for model persistence
- Pre-pull a small fast model (e.g. `llama3.2:3b` or `phi4:mini`) so it works out of the box
- `ingest-api` gets `OLLAMA_URL=http://ollama:11434`

### 2. Ingest API — new endpoints
- `POST /search` — document RAG. Accepts `{query, top_k}`. Embeds the query via Chroma, returns top chunks with source metadata.
- `POST /chat` — chat completions proxy to Ollama with tool definitions.
  - Tools: `search_documents` (query your ChromaDB) and `web_search` (query SearXNG).
  - The sidecar handles the tool-call loop: sends prompt to Ollama, if it calls a tool the sidecar executes it, appends result, and continues until the model returns a final answer.
  - Streams the final answer as SSE (server-sent events) to the UI.
- `GET /chat/models` — list locally available Ollama models so the UI can pick one.

### 3. Webapp — new `/chat` route
- Route file `src/routes/chat.tsx` with TanStack Start.
- `ChatInterface` component:
  - Message list (user / assistant / tool-call bubbles)
  - Model selector dropdown (populated from `/chat/models`)
  - Text input with send button
  - Streaming response renders word-by-word
  - "New chat" button to clear history
- Global nav: add a simple top bar with links to `/documents` and `/chat`.

### 4. Tool schemas (Ollama format)
- `search_documents`: `{query: string, top_k?: number}` → sidecar calls Chroma `collection.query()` and returns `[{source, chunk_index, content}]`.
- `web_search`: `{query: string, max_results?: number}` → sidecar calls SearXNG and returns `[{title, url, content}]`.

## Out of scope for v2
- Conversation persistence (no DB, history lives in React state; refresh = reset)
- Multi-modal (images, voice)
- Tauri bundling (still webapp for now)

## Running it
```bash
cd docker
docker compose up -d
# Ollama will pull the model on first chat — ~2 GB download
```

## Open assumptions
1. **Model choice**: `llama3.2:3b` as default — small, fast, decent tool-calling. User can switch via `/chat/models`.
2. **No auth**: still single-user local.
3. **History is ephemeral**: page refresh clears the thread. Persistent chat history is v3.