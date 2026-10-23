-- Execute após 001 a 006. Preserva contas, frota e convites existentes.
begin;
alter table public.fleeton_invites add column if not exists role text not null default 'driver' check(role in ('driver','manager'));
-- A relação antiga exigia que todo gestor fosse dono. Mantém a proteção do dono.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.fleeton_members'::regclass and contype='c' and pg_get_constraintdef(oid) like '%owner_id%' and conname<>'fleeton_members_relation_check' loop
  execute format('alter table public.fleeton_members drop constraint %I',c.conname);
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.fleeton_members'::regclass and conname='fleeton_members_relation_check') then
  alter table public.fleeton_members add constraint fleeton_members_relation_check check(user_id<>owner_id or role='manager');
 end if;
end $$;

create or replace function public.fleeton_context()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); mail text; profile jsonb; member public.fleeton_members; invitation jsonb;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select email into mail from auth.users where id=uid;
 insert into public.fleeton_profiles(user_id) values(uid) on conflict do nothing;
 insert into public.fleeton_members values(uid,uid,'manager') on conflict do nothing;
 select * into member from public.fleeton_members where user_id=uid;
 select jsonb_build_object('name',name,'avatar',avatar) into profile from public.fleeton_profiles where user_id=uid;
 select jsonb_build_object('email',u.email,'role',i.role) into invitation from public.fleeton_invites i join auth.users u on u.id=i.owner_id where i.email=lower(mail);
 return jsonb_build_object('user_id',uid,'role',member.role,'owner_id',member.owner_id,'is_owner',uid=member.owner_id,'profile',profile,'invitation',invitation);
end $$;

create or replace function public.fleeton_team_roles(p_action text default 'list',p_email text default '',p_role text default 'driver')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; caller_role text; mail text:=lower(trim(p_email)); target uuid; target_role text;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select owner_id,role into owner,caller_role from public.fleeton_members where user_id=uid for share;
 if caller_role is distinct from 'manager' then raise exception 'FLEET_FORBIDDEN'; end if;
 if p_action='invite' then
  if p_role is null or p_role not in ('driver','manager') then raise exception 'TEAM_INVALID'; end if;
  if p_role='manager' and uid<>owner then raise exception 'TEAM_OWNER_ONLY'; end if;
  if mail is null or mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(mail)>254 then raise exception 'EMAIL_INVALID'; end if;
  select id into target from auth.users where lower(email)=mail;
  if target=uid or target=owner then raise exception 'TEAM_SELF'; end if;
  if exists(select 1 from public.fleeton_members where user_id=target and owner_id=owner) then raise exception 'TEAM_MEMBER_EXISTS'; end if;
  if exists(select 1 from public.fleeton_members where user_id=target and owner_id<>user_id)
   or exists(select 1 from public.fleeton_invites where email=mail and owner_id<>owner)
   or exists(select 1 from public.fleeton_fleets where user_id=target and state<>'{"cars":[],"drivers":[],"log":[],"fines":[]}'::jsonb)
   then raise exception 'TEAM_OTHER_FLEET'; end if;
  -- An invited manager cannot replace/cancel a pending manager invitation.
  perform 1 from public.fleeton_invites where email=mail for update;
  if uid<>owner and exists(select 1 from public.fleeton_invites where email=mail and role='manager') then raise exception 'TEAM_OWNER_ONLY'; end if;
  insert into public.fleeton_invites(email,owner_id,role) values(mail,owner,p_role)
   on conflict(email) do update set created_at=now(),role=excluded.role
   where fleeton_invites.owner_id=excluded.owner_id and (uid=owner or fleeton_invites.role<>'manager');
  if not found then raise exception 'TEAM_OTHER_FLEET'; end if;
 elsif p_action='remove' then
  select id into target from auth.users where lower(email)=mail;
  if target=owner or target=uid then raise exception 'TEAM_SELF'; end if;
  if uid<>owner and exists(select 1 from public.fleeton_members where user_id=target and owner_id=owner and role='manager') then raise exception 'TEAM_OWNER_ONLY'; end if;
  select role into target_role from public.fleeton_members where user_id=target and owner_id=owner for update;
  perform 1 from public.fleeton_invites where email=mail and owner_id=owner for update;
  if uid<>owner and (target_role='manager' or exists(select 1 from public.fleeton_invites where email=mail and owner_id=owner and role='manager')) then raise exception 'TEAM_OWNER_ONLY'; end if;
  perform 1 from public.fleeton_fleets where user_id=owner for update;
  if exists(select 1 from public.fleeton_fleets f,jsonb_array_elements(f.state->'cars') c where f.user_id=owner and c->'uso'->>'user_id'=target::text) then raise exception 'TEAM_ACTIVE_TRIP'; end if;
  delete from public.fleeton_invites where email=mail and owner_id=owner;
  delete from public.fleeton_members where user_id=target and owner_id=owner and user_id<>owner;
 elsif p_action is distinct from 'list' then raise exception 'TEAM_INVALID'; end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('email',u.email,'name',p.name,'role',m.role)) from public.fleeton_members m join auth.users u on u.id=m.user_id left join public.fleeton_profiles p on p.user_id=m.user_id where m.owner_id=owner and m.user_id<>owner),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(jsonb_build_object('email',email,'role',role)) from public.fleeton_invites where owner_id=owner),'[]'::jsonb));
end $$;

-- Compatibilidade com clientes anteriores: convite sem cargo continua motorista.
create or replace function public.fleeton_team(p_action text default 'list',p_email text default '')
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.fleeton_team_roles(p_action,p_email,'driver');
$$;

create or replace function public.fleeton_accept_invite()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); mail text; owner uuid; invited_role text;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null;
 select owner_id,role into owner,invited_role from public.fleeton_invites where email=mail for update;
 if owner is null or owner=uid or not exists(select 1 from public.fleeton_members where user_id=owner and owner_id=owner and role='manager') then raise exception 'TEAM_NO_INVITE'; end if;
 perform 1 from public.fleeton_members where user_id=uid for update;
 if exists(select 1 from public.fleeton_members where user_id=uid and owner_id<>uid)
 or exists(select 1 from public.fleeton_fleets where user_id=uid and state<>'{"cars":[],"drivers":[],"log":[],"fines":[]}'::jsonb)
 or exists(select 1 from public.fleeton_invites where owner_id=uid)
 or exists(select 1 from public.fleeton_members where owner_id=uid and user_id<>uid) then raise exception 'TEAM_OTHER_FLEET'; end if;
 insert into public.fleeton_members values(uid,owner,invited_role) on conflict(user_id) do update set owner_id=excluded.owner_id,role=excluded.role;
 delete from public.fleeton_invites where email=mail;
 return public.fleeton_context();
end $$;

create or replace function public.fleeton_save_fleet(p_version bigint,p_state jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; member_role text; next_version bigint;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select owner_id,role into owner,member_role from public.fleeton_members where user_id=uid for share;
 if member_role is distinct from 'manager' then raise exception 'FLEET_FORBIDDEN'; end if;
 if octet_length(p_state::text)>8388608 then raise exception 'FLEET_TOO_LARGE'; end if;
 if p_state is null or not public.fleeton_valid_state(p_state) then raise exception 'FLEET_INVALID'; end if;
 update public.fleeton_fleets set state=p_state,version=version+1,updated_at=now() where user_id=owner and version=p_version returning version into next_version;
 if not found then raise exception 'FLEET_CONFLICT'; end if;
 return jsonb_build_object('version',next_version);
end $$;

create or replace function public.fleeton_save_company(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); member public.fleeton_members; owner uuid; k text; cleaned jsonb:='{}'::jsonb;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select * into member from public.fleeton_members where user_id=uid for update;
 if member.role is distinct from 'manager' then raise exception 'FLEET_FORBIDDEN'; end if;
 owner:=member.owner_id;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>70000 then raise exception 'COMPANY_INVALID'; end if;
 foreach k in array array['name','cnpj','phone','address','logo'] loop
  if jsonb_typeof(p_data->k) is distinct from 'string' then raise exception 'COMPANY_INVALID'; end if;
  cleaned:=cleaned||jsonb_build_object(k,trim(p_data->>k));
 end loop;
 if length(cleaned->>'name') not between 1 and 120
 or length(cleaned->>'cnpj')>18 or ((cleaned->>'cnpj')<>'' and (cleaned->>'cnpj')!~ '^([0-9]{14}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2})$')
 or length(cleaned->>'phone')>30 or length(cleaned->>'address')>300
 or octet_length(cleaned->>'logo')>65536
 or ((cleaned->>'logo')<>'' and (cleaned->>'logo')!~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then raise exception 'COMPANY_INVALID'; end if;
 insert into public.fleeton_companies(owner_id,data) values(owner,cleaned)
 on conflict(owner_id) do update set data=excluded.data,updated_at=now();
 return cleaned;
end $$;

revoke all on function public.fleeton_team_roles(text,text,text) from public,anon;
grant execute on function public.fleeton_team_roles(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
