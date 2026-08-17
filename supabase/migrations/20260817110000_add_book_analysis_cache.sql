alter table public.books
  add column if not exists analysis_cache jsonb,
  add column if not exists analysis_version integer not null default 0;

