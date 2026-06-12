"""Ingest API — parse documents, chunk, embed via Chroma's built-in embedder, upsert.
Also proxies web search to the local SearXNG container."""
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from chromadb.config import Settings

from parsers import parse_file, UnsupportedFileType
from chunker import chunk_text

CHROMA_HOST = os.getenv("CHROMA_HOST", "chromadb")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "documents")
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080").rstrip("/")

app = FastAPI(title="Assistant Ingest API", version="0.1.0")

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


@app.get("/health")
def health():
    try:
        client = _client()
        client.heartbeat()
        return {"status": "ok", "chroma": "ok", "collection": COLLECTION_NAME}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Chroma unreachable: {e}")


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
        # Pull all metadatas (fine for v1 scale). Chroma returns dicts.
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
    docs: List[dict] = sorted(
        grouped.values(),
        key=lambda d: d.get("ingested_at") or "",
        reverse=True,
    )
    return {"documents": docs}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    try:
        coll = _collection()
        coll.delete(where={"doc_id": doc_id})
        return {"ok": True, "id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")


@app.post("/search")
def search_stub():
    """Placeholder for document RAG search — wired up in v2 for the agent's tool call."""
    raise HTTPException(status_code=501, detail="Document search not implemented yet (v2)")


class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 10
    categories: Optional[str] = None  # e.g. "general", "news", "it"
    language: str = "en"
    time_range: Optional[str] = None  # day, week, month, year


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
    """Proxy a web search to the local SearXNG instance, returning JSON results."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query is required")

    params = {
        "q": req.query,
        "format": "json",
        "language": req.language,
        "safesearch": "0",
    }
    if req.categories:
        params["categories"] = req.categories
    if req.time_range:
        params["time_range"] = req.time_range

    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(f"{SEARXNG_URL}/search", params=params)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"SearXNG request failed: {e}")

    if r.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"SearXNG returned {r.status_code}: {r.text[:200]}",
        )

    try:
        payload = r.json()
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="SearXNG did not return JSON — make sure 'json' is in settings.yml formats.",
        )

    raw = payload.get("results") or []
    results = [
        {
            "title": item.get("title"),
            "url": item.get("url"),
            "content": item.get("content"),
            "engine": item.get("engine"),
            "score": item.get("score"),
            "published_date": item.get("publishedDate"),
        }
        for item in raw[: req.max_results]
    ]
    return {
        "query": req.query,
        "count": len(results),
        "results": results,
        "answers": payload.get("answers") or [],
        "suggestions": payload.get("suggestions") or [],
    }

