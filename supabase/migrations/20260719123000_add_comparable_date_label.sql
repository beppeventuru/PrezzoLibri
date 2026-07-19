alter table public.comparables
  add column if not exists date_label text not null default '';
