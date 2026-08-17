create or replace function public.import_marketplace_comparables(p_book_id bigint,p_rows jsonb,p_cover_url text)
returns jsonb language plpgsql set search_path=public as $$
declare result jsonb; current_book jsonb;
begin
  if not exists(select 1 from public.books where id=p_book_id and user_id=auth.uid()) then raise exception 'Libro non accessibile'; end if;
  if coalesce(p_cover_url,'')<>'' then update public.books set cover_url=p_cover_url,updated_at=now() where id=p_book_id; end if;
  result:=public.import_marketplace_comparables(p_book_id,p_rows);
  select to_jsonb(b) into current_book from public.books b where b.id=p_book_id;
  return result||jsonb_build_object('book',current_book);
end; $$;
revoke all on function public.import_marketplace_comparables(bigint,jsonb,text) from public;
grant execute on function public.import_marketplace_comparables(bigint,jsonb,text) to authenticated;
