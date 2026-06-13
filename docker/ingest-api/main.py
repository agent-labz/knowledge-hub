"""Ingest API — parse documents, chunk, embed, upsert, search.
Also proxies web search to SearXNG and chat to Ollama with tool calling."""
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import chromadb
from chromadb.config import Settings

from parsers import parse_file, UnsupportedFileType
from chunker import chunk_text

CHROMA_HOST = os.getenv("CHROMA_HOST", "chromadb")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "documents")
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080").rstrip("/")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "llama3.2:3b")

app = FastAPI(title="Assistant Ingest API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client():
    return chromadb.HttpClient(
        host=CHROMA_HOST,
        port=CHROMA_PORT,
        settings=Settings(anonymized_telemetry=False),
    )


def _collection():
    client = _client()
    return client.get_or_create_collection(name=COLLECTION_NAME)


# ─── Health ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    try:
        _client().heartbeat()
        return {"status": "ok", "chroma": "ok", "collection": COLLECTION_NAME}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Chroma unreachable: {e}")


# ─── Documents ─────────────────────────────────────────────────────────────

@app.post("/documents")
async def upload_document(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        text, mime = parse_file(file.filename or "unknown", content)
    except UnsupportedFileType as e:
        raise HTTPException(status_code=415, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse: {e}")

    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="No text extracted from file")

    doc_id = str(uuid.uuid4())
    ingested_at = datetime.now(timezone.utc).isoformat()
    total = len(chunks)

    ids = [f"{doc_id}:{i}" for i in range(total)]
    metadatas = [
        {
            "doc_id": doc_id,
            "source_name": file.filename or "unknown",
            "mime": mime,
            "chunk_index": i,
            "total_chunks": total,
            "ingested_at": ingested_at,
        }
        for i in range(total)
    ]

    try:
        coll = _collection()
        coll.add(ids=ids, documents=chunks, metadatas=metadatas)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store in Chroma: {e}")

    return {
        "id": doc_id,
        "name": file.filename,
        "mime": mime,
        "chunks": total,
        "ingested_at": ingested_at,
    }


@app.get("/documents")
def list_documents():
    try:
        coll = _collection()
        result = coll.get(include=["metadatas"])
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Chroma error: {e}")

    grouped: Dict[str, dict] = {}
    for meta in result.get("metadatas") or []:
        if not meta:
            continue
        did = meta.get("doc_id")
        if not did:
            continue
        if did not in grouped:
            grouped[did] = {
                "id": did,
                "name": meta.get("source_name", "unknown"),
                "mime": meta.get("mime"),
                "chunks": meta.get("total_chunks", 0),
                "ingested_at": meta.get("ingested_at"),
            }
    docs = sorted(grouped.values(), key=lambda d: d.get("ingested_at") or "", reverse=True)
    return {"documents": docs}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    try:
        coll = _collection()
        coll.delete(where={"doc_id": doc_id})
        return {"ok": True, "id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")


# ─── Document RAG search ───────────────────────────────────────────────────

class DocSearchRequest(BaseModel):
    query: str
    top_k: int = 5


def _do_doc_search(query: str, top_k: int = 5) -> List[dict]:
    coll = _collection()
    res = coll.query(query_texts=[query], n_results=max(1, min(top_k, 25)))
    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    out = []
    for i, content in enumerate(docs):
        meta = metas[i] if i < len(metas) else {}
        out.append({
            "source": meta.get("source_name"),
            "doc_id": meta.get("doc_id"),
            "chunk_index": meta.get("chunk_index"),
            "content": content,
            "distance": dists[i] if i < len(dists) else None,
        })
    return out


@app.post("/search")
def search_documents(req: DocSearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query is required")
    try:
        return {"query": req.query, "results": _do_doc_search(req.query, req.top_k)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")


# ─── Web search ────────────────────────────────────────────────────────────

class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 10
    categories: Optional[str] = None
    language: str = "en"
    time_range: Optional[str] = None


def _do_web_search(query: str, max_results: int = 10) -> List[dict]:
    params = {"q": query, "format": "json", "language": "en", "safesearch": "0"}
    with httpx.Client(timeout=20.0) as client:
        r = client.get(f"{SEARXNG_URL}/search", params=params)
    if r.status_code != 200:
        raise RuntimeError(f"SearXNG {r.status_code}: {r.text[:200]}")
    payload = r.json()
    raw = payload.get("results") or []
    return [
        {
            "title": item.get("title"),
            "url": item.get("url"),
            "content": item.get("content"),
            "engine": item.get("engine"),
        }
        for item in raw[:max_results]
    ]


@app.get("/search/web/health")
def web_search_health():
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{SEARXNG_URL}/healthz")
        return {"status": "ok" if r.status_code == 200 else "degraded", "code": r.status_code}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"SearXNG unreachable: {e}")


@app.post("/search/web")
def web_search(req: WebSearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query is required")
    try:
        results = _do_web_search(req.query, req.max_results)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"query": req.query, "count": len(results), "results": results, "answers": [], "suggestions": []}


# ─── Chat with tool calling (Ollama) ───────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": "Search the user's local document library (ChromaDB) for relevant passages. Use this when the user asks about anything that might be in their uploaded documents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural language search query"},
                    "top_k": {"type": "integer", "description": "Number of results to return (default 5)"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the live web via a private SearXNG metasearch. Use for current events or info not in the user's documents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Web search query"},
                    "max_results": {"type": "integer", "description": "Max results (default 5)"},
                },
                "required": ["query"],
            },
        },
    },
]

SYSTEM_PROMPT = (
    "You are a helpful personal assistant. You have two tools: `search_documents` "
    "to look up info from the user's uploaded document library, and `web_search` "
    "for live info from the internet. Prefer documents first when the question "
    "sounds like it's about the user's own material. Always cite source filenames "
    "or URLs when you use a tool. Be concise."
)


class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str = ""
    tool_calls: Optional[List[dict]] = None
    name: Optional[str] = None  # for tool messages


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None


@app.get("/chat/models")
def chat_models():
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{OLLAMA_URL}/api/tags")
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Ollama returned {r.status_code}")
        data = r.json()
        models = [m.get("name") for m in data.get("models", []) if m.get("name")]
        return {"models": models, "default": DEFAULT_MODEL}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama unreachable: {e}")


def _execute_tool(name: str, args: dict) -> Any:
    try:
        if name == "search_documents":
            q = str(args.get("query", "")).strip()
            k = int(args.get("top_k", 5))
            if not q:
                return {"error": "query is required"}
            return {"results": _do_doc_search(q, k)}
        if name == "web_search":
            q = str(args.get("query", "")).strip()
            n = int(args.get("max_results", 5))
            if not q:
                return {"error": "query is required"}
            return {"results": _do_web_search(q, n)}
        return {"error": f"unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}


def _sse(event: str, data: Any) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")


@app.post("/chat")
def chat(req: ChatRequest):
    model = req.model or DEFAULT_MODEL
    # Build message stack: ensure system prompt first
    msgs: List[dict] = []
    if not req.messages or req.messages[0].role != "system":
        msgs.append({"role": "system", "content": SYSTEM_PROMPT})
    for m in req.messages:
        d: dict = {"role": m.role, "content": m.content}
        if m.tool_calls:
            d["tool_calls"] = m.tool_calls
        if m.name:
            d["name"] = m.name
        msgs.append(d)

    def stream():
        max_rounds = 6
        try:
            for round_i in range(max_rounds):
                # Non-streaming tool-resolution round
                with httpx.Client(timeout=120.0) as client:
                    r = client.post(
                        f"{OLLAMA_URL}/api/chat",
                        json={
                            "model": model,
                            "messages": msgs,
                            "tools": TOOLS,
                            "stream": False,
                        },
                    )
                if r.status_code != 200:
                    yield _sse("error", {"message": f"Ollama {r.status_code}: {r.text[:300]}"})
                    return
                payload = r.json()
                msg = payload.get("message") or {}
                tool_calls = msg.get("tool_calls") or []

                if tool_calls:
                    # Echo assistant tool-call message back into history
                    msgs.append({
                        "role": "assistant",
                        "content": msg.get("content", "") or "",
                        "tool_calls": tool_calls,
                    })
                    for tc in tool_calls:
                        fn = (tc.get("function") or {})
                        name = fn.get("name", "")
                        args = fn.get("arguments") or {}
                        if isinstance(args, str):
                            try:
                                args = json.loads(args)
                            except Exception:
                                args = {}
                        yield _sse("tool_call", {"name": name, "arguments": args})
                        result = _execute_tool(name, args)
                        yield _sse("tool_result", {"name": name, "result": result})
                        msgs.append({
                            "role": "tool",
                            "name": name,
                            "content": json.dumps(result)[:8000],
                        })
                    continue  # next round, hopefully final answer

                # No tool calls — stream the final answer round for nice UX
                with httpx.Client(timeout=300.0) as client:
                    with client.stream(
                        "POST",
                        f"{OLLAMA_URL}/api/chat",
                        json={"model": model, "messages": msgs, "stream": True},
                    ) as sresp:
                        if sresp.status_code != 200:
                            body = sresp.read().decode("utf-8", errors="ignore")
                            yield _sse("error", {"message": f"Ollama {sresp.status_code}: {body[:300]}"})
                            return
                        for line in sresp.iter_lines():
                            if not line:
                                continue
                            try:
                                obj = json.loads(line)
                            except Exception:
                                continue
                            chunk = (obj.get("message") or {}).get("content")
                            if chunk:
                                yield _sse("token", {"text": chunk})
                            if obj.get("done"):
                                break
                yield _sse("done", {})
                return

            yield _sse("error", {"message": "Tool loop exceeded max rounds"})
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream")
