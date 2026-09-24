create or replace function public.order_book_stamp_context()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_user uuid:=public.legacy_data_user_id();
begin
 if v_company is null then raise exception 'No active company selected.'; end if;
 if v_bu is null then raise exception 'No active business unit selected.'; end if;
 if v_user is null then raise exception 'Authentication required.'; end if;
 if new.company_id is null then new.company_id:=v_company; elsif new.company_id<>v_company then raise exception 'Cross-company write denied.'; end if;
 if new.business_unit_id is null then new.business_unit_id:=v_bu; elsif new.business_unit_id<>v_bu then raise exception 'Cross-business-unit write denied.'; end if;
 if to_jsonb(new) ? 'user_id' then new.user_id:=v_user; end if;
 return new;
end $$;

drop trigger if exists order_book_context_stamp on public.order_book_headers;
create trigger order_book_context_stamp before insert or update on public.order_book_headers for each row execute function public.order_book_stamp_context();
drop trigger if exists order_book_context_stamp on public.order_book_commitments;
create trigger order_book_context_stamp before insert or update on public.order_book_commitments for each row execute function public.order_book_stamp_context();
drop trigger if exists order_book_context_stamp on public.order_book_rate_history;
create trigger order_book_context_stamp before insert or update on public.order_book_rate_history for each row execute function public.order_book_stamp_context();
