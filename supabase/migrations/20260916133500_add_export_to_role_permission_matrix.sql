begin;

alter table public.role_permissions
  add column if not exists can_export boolean not null default true;

drop function if exists public.set_role_permission(text,text,boolean,boolean,boolean,boolean,boolean,boolean);

create function public.set_role_permission(
  p_role text,
  p_module_key text,
  p_view boolean,
  p_create boolean,
  p_edit boolean,
  p_delete boolean,
  p_post boolean,
  p_print boolean,
  p_export boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication is required.';
  end if;
  if public.current_erp_role() <> 'admin' then
    raise exception 'Administrator permission is required.';
  end if;
  if nullif(btrim(p_role), '') is null or nullif(btrim(p_module_key), '') is null then
    raise exception 'Role and module are required.';
  end if;

  insert into public.role_permissions(
    user_id, role, module_key, can_view, can_create, can_edit,
    can_delete, can_post, can_print, can_export
  ) values (
    v_user, lower(btrim(p_role)), lower(btrim(p_module_key)), p_view,
    p_create, p_edit, p_delete, p_post, p_print, p_export
  )
  on conflict(user_id, role, module_key) do update set
    can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_edit = excluded.can_edit,
    can_delete = excluded.can_delete,
    can_post = excluded.can_post,
    can_print = excluded.can_print,
    can_export = excluded.can_export,
    updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.set_role_permission(text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.set_role_permission(text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
