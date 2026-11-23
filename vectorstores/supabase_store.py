"""Supabase (PostgREST) vector store plugin - durable collections.

The default Chroma store persists to a local disk directory, which is
wiped whenever an ephemeral host (e.g. a free-tier PaaS) restarts or
redeploys. This backend stores chunks and their embeddings in a Postgres
table hosted by Supabase, so collections survive restarts.

Schema: see supabase_schema.sql in the repository root (table rf_chunks).
Selected automatically when SUPABASE_URL and SUPABASE_KEY are set in the
environment - see core/container.py. Uses only the standard library, so
requirements.txt does not change.
"""

import json
import math
import urllib.error
import urllib.parse
import urllib.request

from core.contracts import VectorStoreBackend
from core.registry import register_plugin

TABLE = "rf_chunks"


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


@register_plugin("vectorstores", "supabase")
class SupabaseVectorStore(VectorStoreBackend):
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.service_key = service_key

    # ---------- transport (single seam, patched in tests) ----------

    def _request(self, method: str, path: str, body=None, extra_headers: dict | None = None):
        headers = {
            "apikey": self.service_key,
            "Authorization": "Bearer " + self.service_key,
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"Supabase request failed ({error.code}): {detail}") from error
        return json.loads(raw) if raw.strip() else None

    @staticmethod
    def _filter(collection_name: str) -> str:
        return "collection_name=eq." + urllib.parse.quote(collection_name, safe="")

    # ---------- VectorStoreBackend ----------

    def add_documents(
        self,
        collection_name: str,
        documents: list[str],
        embeddings: list[list[float]],
        ids: list[str],
    ) -> None:
        if not documents:
            return
        rows = [
            {
                "chunk_id": chunk_id,
                "collection_name": collection_name,
                "content": document,
                "embedding": embedding,
            }
            for chunk_id, document, embedding in zip(ids, documents, embeddings)
        ]
        self._request(
            "POST",
            f"/{TABLE}",
            body=rows,
            extra_headers={"Prefer": "resolution=merge-duplicates"},
        )

    def query(self, collection_name: str, query_embeddings: list[list[float]], n_results: int = 4) -> list[str]:
        if not query_embeddings:
            return []

        # 1. Preferred fast path: server-side pgvector similarity search via stored procedure
        try:
            payload = {
                "query_embedding": query_embeddings[0],
                "match_collection": collection_name,
                "match_count": n_results,
            }
            results = self._request("POST", "/rpc/match_rf_chunks", body=payload)
            if results is not None and isinstance(results, list):
                return [row["content"] for row in results if "content" in row]
        except Exception:
            pass

        # 2. Fallback path: REST query for backward compatibility with unmigrated schemas
        rows = self._request("GET", f"/{TABLE}?{self._filter(collection_name)}&select=content,embedding") or []
        if not rows:
            return []
        query_vector = query_embeddings[0]
        ranked = sorted(rows, key=lambda row: _cosine(query_vector, row["embedding"]), reverse=True)
        return [row["content"] for row in ranked[:n_results]]

    def delete_collection(self, collection_name: str) -> bool:
        deleted = self._request(
            "DELETE",
            f"/{TABLE}?{self._filter(collection_name)}",
            extra_headers={"Prefer": "return=representation"},
        )
        return bool(deleted)

    def list_collections(self) -> list[str]:
        rows = self._request("GET", f"/{TABLE}?select=collection_name") or []
        return sorted({row["collection_name"] for row in rows})
