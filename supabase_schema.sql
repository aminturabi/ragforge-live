-- RAGForge durable storage (Supabase / Postgres with pgvector)
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Enables vector extension, creates the rf_chunks table, vector index, and match RPC function.

create extension if not exists vector;

create table if not exists public.rf_chunks (
  chunk_id text primary key,
  collection_name text not null,
  content text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

-- Index for filtering by collection
create index if not exists rf_chunks_collection_idx
  on public.rf_chunks (collection_name);

-- Fast approximate nearest neighbor index for vector cosine similarity
create index if not exists rf_chunks_embedding_idx
  on public.rf_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Table access grants for the API
grant select, insert, update, delete on public.rf_chunks to service_role;

-- Stored procedure for server-side cosine similarity search via pgvector
create or replace function match_rf_chunks (
  query_embedding vector(384),
  match_collection text,
  match_count int default 4
)
returns table (
  chunk_id text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    rf_chunks.chunk_id,
    rf_chunks.content,
    1 - (rf_chunks.embedding <=> query_embedding) as similarity
  from public.rf_chunks
  where rf_chunks.collection_name = match_collection
  order by rf_chunks.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_rf_chunks to service_role, anon;
