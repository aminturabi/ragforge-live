"""Recursive character chunking strategy preserving semantic boundaries."""

from core.contracts import ChunkingStrategy
from core.registry import register_plugin


@register_plugin("chunkers", "recursive_character")
class RecursiveCharacterChunker(ChunkingStrategy):
    """Splits text recursively by semantic separators (paragraphs, lines, sentences, words, characters)."""

    def __init__(
        self,
        chunk_size: int = 1000,
        overlap: int = 150,
        separators: list[str] | None = None,
    ) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if overlap < 0:
            raise ValueError("overlap cannot be negative")
        if overlap >= chunk_size:
            raise ValueError("overlap must be smaller than chunk_size")
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.separators = separators or ["\n\n", "\n", ". ", " ", ""]

    def _split_text(self, text: str, separators: list[str]) -> list[str]:
        final_chunks: list[str] = []
        separator = separators[-1]
        new_separators = []

        for i, sep in enumerate(separators):
            if sep == "":
                separator = ""
                break
            if sep in text:
                separator = sep
                new_separators = separators[i + 1 :]
                break

        splits = text.split(separator) if separator else list(text)

        good_splits: list[str] = []
        for piece in splits:
            if len(piece) < self.chunk_size:
                good_splits.append(piece)
            else:
                if good_splits:
                    merged = self._merge_splits(good_splits, separator)
                    final_chunks.extend(merged)
                    good_splits = []
                if not new_separators:
                    final_chunks.append(piece)
                else:
                    sub_chunks = self._split_text(piece, new_separators)
                    final_chunks.extend(sub_chunks)

        if good_splits:
            merged = self._merge_splits(good_splits, separator)
            final_chunks.extend(merged)

        return final_chunks

    def _merge_splits(self, splits: list[str], separator: str) -> list[str]:
        docs: list[str] = []
        current_doc: list[str] = []
        total = 0

        for piece in splits:
            piece_len = len(piece)
            sep_len = len(separator) if current_doc else 0

            if total + piece_len + sep_len > self.chunk_size and current_doc:
                doc = separator.join(current_doc).strip()
                if doc:
                    docs.append(doc)

                while current_doc and (
                    total > self.overlap
                    or (total + piece_len + (len(separator) if current_doc else 0) > self.chunk_size and total > 0)
                ):
                    removed = current_doc.pop(0)
                    total -= len(removed)
                    if current_doc:
                        total -= len(separator)

            current_doc.append(piece)
            total += len(piece) + (len(separator) if len(current_doc) > 1 else 0)

        if current_doc:
            doc = separator.join(current_doc).strip()
            if doc:
                docs.append(doc)

        return docs

    def chunk(self, text: str) -> list[str]:
        normalized = text.strip()
        if not normalized:
            return []
        if len(normalized) <= self.chunk_size:
            return [normalized]

        return self._split_text(normalized, self.separators)

