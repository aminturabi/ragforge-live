"""Tests for the Supabase vector store + env-based selection.

The store's single transport seam (_request) is replaced with a fake, so
no network or Supabase project is needed.
"""

from core.config import RAGConfig
from core.container import apply_env_overrides
from vectorstores.supabase_store import SupabaseVectorStore


class FakeStore(SupabaseVectorStore):
    def __init__(self, responses):
        super().__init__("https://example.supabase.co", "test-key")
        self.responses = responses  # {(method): value or callable}
        self.calls = []

    def _request(self, method, path, body=None, extra_headers=None):
        self.calls.append(
            {"method": method, "path": path, "body": body, "headers": extra_headers or {}}
        )
        value = self.responses.get(method)
        return value(method, path, body) if callable(value) else value


def test_add_documents_posts_upsert_rows():
    store = FakeStore({"POST": None})
    store.add_documents("col_a", ["hello", "world"], [[1.0, 0.0], [0.0, 1.0]], ["id1", "id2"])
    assert len(store.calls) == 1
    call = store.calls[0]
    assert call["method"] == "POST"
    assert call["path"] == "/rf_chunks"
    assert call["headers"]["Prefer"] == "resolution=merge-duplicates"
    assert call["body"] == [
        {"chunk_id": "id1", "collection_name": "col_a", "content": "hello", "embedding": [1.0, 0.0]},
        {"chunk_id": "id2", "collection_name": "col_a", "content": "world", "embedding": [0.0, 1.0]},
    ]


def test_add_documents_empty_is_noop():
    store = FakeStore({})
    store.add_documents("col_a", [], [], [])
    assert store.calls == []


def test_query_ranks_by_cosine_similarity():
    rows = [
        {"content": "orthogonal", "embedding": [0.0, 1.0]},
        {"content": "exact", "embedding": [1.0, 0.0]},
        {"content": "diagonal", "embedding": [0.7, 0.7]},
    ]
    store = FakeStore({"GET": rows})
    results = store.query("col_a", [[1.0, 0.0]], n_results=2)
    assert results == ["exact", "diagonal"]
    assert "collection_name=eq.col_a" in store.calls[0]["path"]


def test_query_unknown_collection_returns_empty():
    store = FakeStore({"GET": []})
    assert store.query("col_missing", [[1.0, 0.0]]) == []


def test_delete_collection_reports_whether_rows_existed():
    assert FakeStore({"DELETE": [{"chunk_id": "x"}]}).delete_collection("col_a") is True
    assert FakeStore({"DELETE": []}).delete_collection("col_a") is False


def test_list_collections_dedupes_and_sorts():
    rows = [
        {"collection_name": "col_b"},
        {"collection_name": "col_a"},
        {"collection_name": "col_b"},
    ]
    store = FakeStore({"GET": rows})
    assert store.list_collections() == ["col_a", "col_b"]


def test_env_override_selects_supabase(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "secret")
    cfg = apply_env_overrides(RAGConfig())
    assert cfg.vectorstore.name == "supabase"
    assert cfg.vectorstore.options == {
        "url": "https://example.supabase.co",
        "service_key": "secret",
    }


def test_env_override_absent_keeps_chroma(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    cfg = apply_env_overrides(RAGConfig())
    assert cfg.vectorstore.name == "chroma"
