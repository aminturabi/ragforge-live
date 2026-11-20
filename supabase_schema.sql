-- RAGForge durable storage (Supabase / Postgres)
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query),
-- then set SUPABASE_URL and SUPABASE_KEY in the backend's environment.
-- The backend talks to this table through PostgREST with the service_role
-- key, which bypasses row-level security, so no policies are needed.

create table if not exists public.rf_chunks (
  chunk_id text primary key,
  collection_name text not null,
  content text not null,
  embedding jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists rf_chunks_collection_idx
  on public.rf_chunks (collection_name);
