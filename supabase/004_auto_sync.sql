-- Execute após 001, 002 e 003. Acrescenta somente uma consulta leve de versão.
begin;
create or replace function public.fleeton_sync_status()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; member_role text; ver bigint;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select owner_id,role into owner,member_role from public.fleeton_members where user_id=uid;
 owner:=coalesce(owner,uid);member_role:=coalesce(member_role,'manager');
 select version into ver from public.fleeton_fleets where user_id=owner;
 return jsonb_build_object('owner_id',owner,'role',member_role,'version',coalesce(ver,0));
end $$;
revoke all on function public.fleeton_sync_status() from public,anon;
grant execute on function public.fleeton_sync_status() to authenticated;
notify pgrst,'reload schema';
commit;
