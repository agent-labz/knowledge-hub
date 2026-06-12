"""Simple recursive character text splitter."""
from typing import List

SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def chunk_text(text: str, chunk_size: int = 800, chunk_overlap: int = 100) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            # try to break at a nice separator
            for sep in SEPARATORS:
                if not sep:
                    break
                idx = text.rfind(sep, start, end)
                if idx != -1 and idx > start + chunk_size // 2:
                    end = idx + len(sep)
                    break
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - chunk_overlap, start + 1)
    return chunks
