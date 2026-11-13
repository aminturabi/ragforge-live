"""Embedding plugin (live-demo build).

Same plugin name and interface as the original SentenceTransformer plugin,
but runs all-MiniLM-L6-v2 through ONNX Runtime (via ChromaDB's default
embedding function) instead of PyTorch, so the demo fits free-tier hosting.
"""

from core.contracts import EmbeddingModel
from core.registry import register_plugin


@register_plugin("embeddings", "sentence_transformer")
class SentenceTransformerEmbeddings(EmbeddingModel):
    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        self.model_name = model_name
        self._fn = None

    def _get_fn(self):
        if self._fn is None:
            from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

            self._fn = DefaultEmbeddingFunction()
        return self._fn

    def embed(self, text: str) -> list[float]:
        result = self._get_fn()([text])
        return [float(x) for x in result[0]]

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        result = self._get_fn()(texts)
        return [[float(x) for x in vec] for vec in result]
