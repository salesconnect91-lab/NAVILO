create or replace function public.navilo_link_posting_traceability()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='journal_entries' and new.source_document_id is null then
  if lower(coalesce(new.trans_type,'')) in ('sales invoice','sales') then
   select so.id into new.source_document_id from public.sales_orders so where so.company_id=new.company_id and so.order_no=new.entry_no order by so.created_at desc limit 1;
   if new.source_document_id is not null then new.source_module:=coalesce(new.source_module,'sales'); new.source_document_type:=coalesce(new.source_document_type,'sales_invoice'); end if;
  elsif lower(coalesce(new.trans_type,'')) in ('purchase invoice','purchase') then
   select po.id into new.source_document_id from public.purchase_orders po where po.company_id=new.company_id and ('PUR-'||po.order_no=new.entry_no or po.order_no=new.entry_no) order by po.created_at desc limit 1;
   if new.source_document_id is not null then new.source_module:=coalesce(new.source_module,'purchase'); new.source_document_type:=coalesce(new.source_document_type,'purchase_invoice'); end if;
  end if;
 elsif tg_table_name='stock_movements' and new.source_id is null and nullif(btrim(coalesce(new.reference,'')),'') is not null then
  if lower(coalesce(new.type,''))='out' then
   select so.id into new.source_id from public.sales_orders so where so.company_id=new.company_id and so.order_no=new.reference order by so.created_at desc limit 1;
   if new.source_id is not null then new.source_type:='sales_invoice'; end if;
  elsif lower(coalesce(new.type,''))='in' then
   select po.id into new.source_id from public.purchase_orders po where po.company_id=new.company_id and po.order_no=new.reference order by po.created_at desc limit 1;
   if new.source_id is not null then new.source_type:='purchase_invoice'; end if;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists trg_navilo_link_journal_traceability on public.journal_entries;
create trigger trg_navilo_link_journal_traceability before insert or update on public.journal_entries for each row execute function public.navilo_link_posting_traceability();
drop trigger if exists trg_navilo_link_stock_traceability on public.stock_movements;
create trigger trg_navilo_link_stock_traceability before insert or update on public.stock_movements for each row execute function public.navilo_link_posting_traceability();

