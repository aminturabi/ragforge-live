from chunking.recursive_character import RecursiveCharacterChunker


def test_recursive_character_chunker_returns_overlapping_chunks():
    chunker = RecursiveCharacterChunker(chunk_size=10, overlap=2)
    chunks = chunker.chunk("abcdefghijklmnopqrstuvwxyz")
    assert chunks[0] == "abcdefghij"
    assert chunks[1].startswith("ij")
    assert len(chunks) >= 3


def test_recursive_character_chunker_preserves_words_and_sentences():
    text = (
        "Amin Khan is an AI Engineer based in Pakistan.\n\n"
        "He builds end-to-end RAG chatbots and document AI pipelines.\n\n"
        "Contact email is aminkhanazikhail@gmail.com for inquiries."
    )
    chunker = RecursiveCharacterChunker(chunk_size=80, overlap=20)
    chunks = chunker.chunk(text)
    assert len(chunks) >= 2
    # Verify whole words and full email address are preserved
    for chunk in chunks:
        if "aminkhanazikhail" in chunk:
            assert "aminkhanazikhail@gmail.com" in chunk


def test_recursive_character_chunker_empty_and_short():
    chunker = RecursiveCharacterChunker(chunk_size=100, overlap=10)
    assert chunker.chunk("") == []
    assert chunker.chunk("   ") == []
    assert chunker.chunk("Short text") == ["Short text"]

