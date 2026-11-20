"""Dependency wiring for default framework runtime."""

import os

from core.config import ComponentConfig, RAGConfig
from core.registry import create_plugin
from core.service import RAGService
from plugins import discover_plugins


def apply_env_overrides(cfg: RAGConfig) -> RAGConfig:
    """Environment-driven component swaps for the deployed service.

    When SUPABASE_URL and SUPABASE_KEY are set, collections live in a
    durable Supabase Postgres table instead of the local Chroma disk
    store (whose directory is wiped on every restart of an ephemeral
    host). While the variables are unset, defaults apply unchanged.
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    if supabase_url and supabase_key:
        cfg.vectorstore = ComponentConfig(
            "supabase", {"url": supabase_url, "service_key": supabase_key}
        )
    return cfg


def build_service(config: RAGConfig | None = None) -> RAGService:
    cfg = config or RAGConfig()
    if config is None:
        cfg = apply_env_overrides(cfg)

    discover_plugins()

    loader = create_plugin("loaders", cfg.loader.name, **cfg.loader.options)
    chunker = create_plugin("chunkers", cfg.chunker.name, **cfg.chunker.options)
    embeddings = create_plugin("embeddings", cfg.embeddings.name, **cfg.embeddings.options)
    vectorstore = create_plugin("vectorstores", cfg.vectorstore.name, **cfg.vectorstore.options)
    retriever = create_plugin(
        "retrievers",
        cfg.retriever.name,
        vector_store=vectorstore,
        embedding_model=embeddings,
        **cfg.retriever.options,
    )
    reranker = create_plugin("rerankers", cfg.reranker.name, **cfg.reranker.options)
    llm = create_plugin("llms", cfg.llm.name, **cfg.llm.options)
    formatter = create_plugin("formatters", cfg.formatter.name, **cfg.formatter.options)

    return RAGService(
        loader=loader,
        chunker=chunker,
        embeddings=embeddings,
        vectorstore=vectorstore,
        retriever=retriever,
        reranker=reranker,
        llm=llm,
        formatter=formatter,
    )

