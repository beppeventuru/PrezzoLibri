create or replace function public.import_marketplace_comparables(p_book_id bigint, p_rows jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare inserted_count integer:=0; removed_count integer:=0;
begin
  if not exists(select 1 from public.books where id=p_book_id and user_id=auth.uid()) then raise exception 'Libro non accessibile'; end if;
  with ranked as (select id,row_number() over(partition by evidence_type,lower(title),lower(condition),price,shipping order by observed_at desc,id desc) position from public.comparables where book_id=p_book_id and platform='amazon'),
  removed as (delete from public.comparables where id in(select id from ranked where position>1) returning id) select count(*) into removed_count from removed;
  update public.comparables e set date_label=i.date_label from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as i(platform text,url text,title text,price numeric,shipping numeric,condition text,relevance text,evidence_type text,date_label text,accepted boolean)
  where e.book_id=p_book_id and i.date_label<>'' and e.date_label is distinct from i.date_label and ((i.platform<>'amazon' and e.platform=i.platform and e.url=i.url) or (i.platform='amazon' and e.platform='amazon' and e.evidence_type=i.evidence_type and lower(e.title)=lower(i.title) and lower(e.condition)=lower(i.condition) and e.price=i.price and e.shipping=i.shipping));
  with incoming as (select * from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as r(platform text,url text,title text,price numeric,shipping numeric,condition text,relevance text,evidence_type text,date_label text,accepted boolean)),
  inserted as (insert into public.comparables(book_id,platform,url,title,price,shipping,condition,relevance,evidence_type,date_label,accepted)
    select p_book_id,i.platform,i.url,i.title,i.price,i.shipping,i.condition,i.relevance,i.evidence_type,i.date_label,i.accepted from incoming i where not exists(select 1 from public.comparables e where e.book_id=p_book_id and ((i.platform<>'amazon' and e.platform=i.platform and e.url=i.url) or (i.platform='amazon' and e.platform='amazon' and e.evidence_type=i.evidence_type and lower(e.title)=lower(i.title) and lower(e.condition)=lower(i.condition) and e.price=i.price and e.shipping=i.shipping))) returning id)
  select count(*) into inserted_count from inserted;
  return jsonb_build_object('added',inserted_count,'removed_duplicates',removed_count,'comparables',coalesce((select jsonb_agg(to_jsonb(c) order by c.observed_at desc) from public.comparables c where c.book_id=p_book_id),'[]'::jsonb));
end; $$;
revoke all on function public.import_marketplace_comparables(bigint,jsonb) from public;
grant execute on function public.import_marketplace_comparables(bigint,jsonb) to authenticated;
