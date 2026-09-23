create or replace function public.propagate_business_unit_from_parent()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_parent_id uuid; v_parent_unit uuid; v_parent_company uuid; v_sql text;
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return new; end if;
 v_parent_id:=nullif(to_jsonb(new)->>tg_argv[1],'')::uuid;
 if v_parent_id is null then return new; end if;
 v_sql:=format('select business_unit_id,company_id from public.%I where id=$1',tg_argv[0]);
 execute v_sql into v_parent_unit,v_parent_company using v_parent_id;
 if v_parent_company is null then raise exception 'Parent record not found for %.',tg_table_name; end if;
 if new.company_id is null then new.company_id:=v_parent_company; end if;
 if new.company_id is distinct from v_parent_company then raise exception 'Child and parent company do not match.'; end if;
 if new.business_unit_id is not null and new.business_unit_id is distinct from v_parent_unit then raise exception 'Child and parent business unit do not match.'; end if;
 new.business_unit_id:=v_parent_unit; return new;
end;$function$;