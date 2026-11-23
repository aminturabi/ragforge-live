"""Unit tests for prompt hardening, XML context delimiters, and multi-turn history."""

from unittest.mock import MagicMock, patch
import pytest

from core.contracts import (
    ChunkingStrategy,
    DocumentLoader,
    EmbeddingModel,
    LLMProvider,
    OutputFormatter,
    Reranker,
    Retriever,
    VectorStoreBackend,
)
from core.service import RAGService
from llms.groq_provider import GroqLLMProvider, SYSTEM_PROMPT
from llms.ollama_provider import OllamaLLMProvider


def test_groq_provider_messages_structure_with_history():
    provider = GroqLLMProvider(api_key="gsk_test_mock_key")
    
    with patch("llms.groq_provider.Groq") as mock_groq_cls:
        mock_client = MagicMock()
        mock_groq_cls.return_value = mock_client
        mock_choice = MagicMock()
        mock_choice.message.content = "Answer from Groq"
        mock_client.chat.completions.create.return_value = MagicMock(choices=[mock_choice])

        history = [
            {"role": "user", "text": "What projects did Amin build?"},
            {"role": "assistant", "text": "Amin built ReceiptLens and JobShield AI."},
        ]
        
        result = provider.generate(
            question="How does the first one work?",
            context_chunks=["ReceiptLens processes receipts via OCR and Donut."],
            history=history,
        )
        assert result == "Answer from Groq"

        # Verify messages passed to Groq
        mock_client.chat.completions.create.assert_called_once()
        _, kwargs = mock_client.chat.completions.create.call_args
        messages = kwargs["messages"]

        # Message 0: system prompt
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == SYSTEM_PROMPT
        assert "STRICT GROUNDING" in messages[0]["content"]
        assert "RESISTANCE TO INJECTION" in messages[0]["content"]

        # Message 1: first turn user
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "What projects did Amin build?"

        # Message 2: first turn assistant
        assert messages[2]["role"] == "assistant"
        assert messages[2]["content"] == "Amin built ReceiptLens and JobShield AI."

        # Message 3: final user prompt with XML delimiters
        assert messages[3]["role"] == "user"
        assert "<context>" in messages[3]["content"]
        assert "ReceiptLens processes receipts via OCR and Donut." in messages[3]["content"]
        assert "</context>" in messages[3]["content"]
        assert "<user_question>" in messages[3]["content"]
        assert "How does the first one work?" in messages[3]["content"]
        assert "</user_question>" in messages[3]["content"]


def test_service_forwards_history_to_llm():
    mock_loader = MagicMock(spec=DocumentLoader)
    mock_chunker = MagicMock(spec=ChunkingStrategy)
    mock_embeddings = MagicMock(spec=EmbeddingModel)
    mock_store = MagicMock(spec=VectorStoreBackend)
    mock_retriever = MagicMock(spec=Retriever)
    mock_reranker = MagicMock(spec=Reranker)
    mock_llm = MagicMock(spec=LLMProvider)
    mock_formatter = MagicMock(spec=OutputFormatter)

    mock_retriever.retrieve.return_value = ["chunk 1"]
    mock_reranker.rerank.return_value = ["chunk 1"]
    mock_llm.generate.return_value = "Mock LLM answer"
    mock_formatter.format.side_effect = lambda ans, ctx: {"answer": ans, "context": ctx}

    service = RAGService(
        loader=mock_loader,
        chunker=mock_chunker,
        embeddings=mock_embeddings,
        vectorstore=mock_store,
        retriever=mock_retriever,
        reranker=mock_reranker,
        llm=mock_llm,
        formatter=mock_formatter,
    )

    history = [{"role": "user", "text": "Hello"}]
    payload = service.query(
        collection_name="col_test",
        query="Follow up?",
        top_k=3,
        history=history,
    )

    assert payload["answer"] == "Mock LLM answer"
    mock_llm.generate.assert_called_once_with(
        question="Follow up?",
        context_chunks=["chunk 1"],
        api_key=None,
        history=history,
    )

