-- Execute depois de 001_fleeton.sql. Preserva frotas e contas existentes.
begin;
create table if not exists public.fleeton_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 name text not null default '' check (char_length(name)<=80),
 avatar text not null default '' check (octet_length(avatar)<=65536 and (avatar='' or avatar ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'))
);
create table if not exists public.fleeton_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 role text not null check (role in ('manager','driver')),
 check ((role='manager' and user_id=owner_id) or (role='driver' and user_id<>owner_id))
);
create table if not exists public.fleeton_invites (
 email text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.fleeton_profiles enable row level security;
alter table public.fleeton_members enable row level security;
alter table public.fleeton_invites enable row level security;
revoke all on public.fleeton_profiles,public.fleeton_members,public.fleeton_invites from anon,authenticated;
-- Todo acesso ocorre pelas funções com identidade derivada de auth.uid().
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
 select jsonb_build_object('email',u.email) into invitation from public.fleeton_invites i join auth.users u on u.id=i.owner_id where i.email=lower(mail);
 return jsonb_build_object('user_id',uid,'role',member.role,'owner_id',member.owner_id,'profile',profile,'invitation',invitation);
end $$;

create or replace function public.fleeton_save_profile(p_name text,p_avatar text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 if p_name is null or length(trim(p_name))<1 or length(p_name)>80 or p_avatar is null or octet_length(p_avatar)>65536
 or (p_avatar<>'' and p_avatar !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then raise exception 'PROFILE_INVALID'; end if;
 insert into public.fleeton_profiles values(uid,trim(p_name),p_avatar) on conflict(user_id) do update set name=excluded.name,avatar=excluded.avatar;
 return jsonb_build_object('name',trim(p_name),'avatar',p_avatar);
end $$;

create or replace function public.fleeton_team(p_action text default 'list',p_email text default '')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); mail text:=lower(trim(p_email)); target uuid;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 if exists(select 1 from public.fleeton_members where user_id=uid and role<>'manager') then raise exception 'FLEET_FORBIDDEN'; end if;
 if p_action='invite' then
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(mail)>254 then raise exception 'EMAIL_INVALID'; end if;
  select id into target from auth.users where lower(email)=mail;
  if target=uid then raise exception 'TEAM_SELF'; end if;
  if exists(select 1 from public.fleeton_members where user_id=target and owner_id<>uid and role='driver')
   or exists(select 1 from public.fleeton_invites where email=mail and owner_id<>uid)
   or exists(select 1 from public.fleeton_fleets where user_id=target and state<>'{"cars":[],"drivers":[],"log":[],"fines":[]}'::jsonb)
   then raise exception 'TEAM_OTHER_FLEET'; end if;
  insert into public.fleeton_invites(email,owner_id) values(mail,uid) on conflict(email) do update set created_at=now();
 elsif p_action='remove' then
  select id into target from auth.users where lower(email)=mail;
  perform 1 from public.fleeton_members where user_id=target and owner_id=uid for update;
  if exists(select 1 from public.fleeton_fleets f,jsonb_array_elements(f.state->'cars') c where f.user_id=uid and c->'uso'->>'user_id'=target::text) then raise exception 'TEAM_ACTIVE_TRIP'; end if;
  delete from public.fleeton_invites where email=mail and owner_id=uid;
  delete from public.fleeton_members where user_id=target and owner_id=uid and role='driver';
 elsif p_action<>'list' then raise exception 'TEAM_INVALID'; end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('email',u.email,'name',p.name)) from public.fleeton_members m join auth.users u on u.id=m.user_id left join public.fleeton_profiles p on p.user_id=m.user_id where m.owner_id=uid and m.role='driver'),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(jsonb_build_object('email',email)) from public.fleeton_invites where owner_id=uid),'[]'::jsonb));
end $$;

create or replace function public.fleeton_accept_invite()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); mail text; owner uuid;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null;
 select owner_id into owner from public.fleeton_invites where email=mail for update;
 if owner is null or owner=uid or exists(select 1 from public.fleeton_members where user_id=owner and role='driver') then raise exception 'TEAM_NO_INVITE'; end if;
 if exists(select 1 from public.fleeton_members where user_id=uid and role='driver')
 or exists(select 1 from public.fleeton_fleets where user_id=uid and state<>'{"cars":[],"drivers":[],"log":[],"fines":[]}'::jsonb)
 or exists(select 1 from public.fleeton_invites where owner_id=uid)
 or exists(select 1 from public.fleeton_members where owner_id=uid and role='driver') then raise exception 'TEAM_OTHER_FLEET'; end if;
 insert into public.fleeton_members values(uid,owner,'driver') on conflict(user_id) do update set owner_id=excluded.owner_id,role='driver';
 delete from public.fleeton_invites where email=mail;
 return public.fleeton_context();
end $$;

-- Motoristas não leem o documento completo nem valores financeiros.
create or replace function public.fleeton_get_fleet()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; member_role text; result jsonb; body jsonb; ver bigint; driver_name text;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select owner_id,role into owner,member_role from public.fleeton_members where user_id=uid;
 owner:=coalesce(owner,uid);
 insert into public.fleeton_fleets(user_id) values(owner) on conflict do nothing;
 select state,version into body,ver from public.fleeton_fleets where user_id=owner;
 if member_role='driver' then
  select coalesce(nullif(p.name,''),u.email) into driver_name from auth.users u left join public.fleeton_profiles p on p.user_id=u.id where u.id=uid;
  select coalesce(jsonb_agg(jsonb_build_object('id',c->'id','placa',c->'placa','modelo',c->'modelo','km',c->'km','prox',c->'prox','uso',c->'uso')),'[]'::jsonb) into result from jsonb_array_elements(body->'cars') c;
  body:=jsonb_build_object('cars',result,'drivers',jsonb_build_array(jsonb_build_object('id',0,'nome',driver_name)),'log','[]'::jsonb,'fines','[]'::jsonb);
 end if;
 return jsonb_build_object('version',ver,'state',body);
end $$;

create or replace function public.fleeton_save_fleet(p_version bigint,p_state jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); next_version bigint;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 if exists(select 1 from public.fleeton_members where user_id=uid and role='driver') then raise exception 'FLEET_FORBIDDEN'; end if;
 if octet_length(p_state::text)>8388608 then raise exception 'FLEET_TOO_LARGE'; end if;
 if p_state is null or not public.fleeton_valid_state(p_state) then raise exception 'FLEET_INVALID'; end if;
 update public.fleeton_fleets set state=p_state,version=version+1,updated_at=now() where user_id=uid and version=p_version returning version into next_version;
 if not found then raise exception 'FLEET_CONFLICT'; end if;
 return jsonb_build_object('version',next_version);
end $$;

create or replace function public.fleeton_driver_trip(p_version bigint,p_car_id numeric,p_action text,p_km numeric default null,p_destination text default '',p_condition text default '',p_photo text default '')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; body jsonb; ver bigint; car jsonb; idx int; driver_name text; entry jsonb; moment text; ticks numeric;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 -- Serialize permission changes/removal with a trip already in progress.
 select owner_id into owner from public.fleeton_members where user_id=uid and role='driver' for share;
 if owner is null then raise exception 'FLEET_FORBIDDEN'; end if;
 select state,version into body,ver from public.fleeton_fleets where user_id=owner for update;
 if ver is distinct from p_version then raise exception 'FLEET_CONFLICT'; end if;
 if p_destination is null or length(p_destination)>300 or p_condition is null or length(p_condition)>500 or p_photo is null or octet_length(p_photo)>262144 or (p_photo<>'' and p_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then raise exception 'TRIP_INVALID'; end if;
 select value,(ordinality-1)::int into car,idx from jsonb_array_elements(body->'cars') with ordinality where (value->>'id')::numeric=p_car_id;
 if car is null then raise exception 'TRIP_INVALID'; end if;
 select coalesce(nullif(p.name,''),u.email) into driver_name from auth.users u left join public.fleeton_profiles p on p.user_id=u.id where u.id=uid;
 moment:=to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'); ticks:=floor(extract(epoch from clock_timestamp())*1000);
 if p_action='out' then
  if car->'uso' is not null and car->'uso'<>'null'::jsonb then raise exception 'TRIP_IN_USE'; end if;
  if length(trim(p_destination))=0 or exists(select 1 from jsonb_array_elements(body->'cars') c where c->'uso'->>'user_id'=uid::text) then raise exception 'TRIP_INVALID'; end if;
  car:=jsonb_set(car,'{uso}',jsonb_build_object('user_id',uid,'mot',driver_name,'dest',trim(p_destination),'quando',moment,'kmIni',car->'km'));
  entry:=jsonb_build_object('user_id',uid,'quando',moment,'t',ticks,'placa',car->'placa','tipo','Saída','det',driver_name||' → '||trim(p_destination)||' · combustível '||p_condition,'foto',p_photo);
 elsif p_action='in' then
  if car->'uso'->>'user_id' is distinct from uid::text then raise exception 'FLEET_FORBIDDEN'; end if;
  if p_km is null or p_km::text in ('NaN','Infinity','-Infinity') or p_km<(car->>'km')::numeric then raise exception 'TRIP_KM'; end if;
  entry:=jsonb_build_object('user_id',uid,'quando',moment,'t',ticks,'placa',car->'placa','tipo','Devolução','rodou',p_km-(car->'uso'->>'kmIni')::numeric,'det',driver_name||' rodou '||(p_km-(car->'uso'->>'kmIni')::numeric)::text||' km · combustível '||p_condition,'foto',p_photo);
  car:=jsonb_set(jsonb_set(car,'{km}',to_jsonb(p_km)),'{uso}','null'::jsonb);
 else raise exception 'TRIP_INVALID'; end if;
 body:=jsonb_set(body,array['cars',idx::text],car);body:=jsonb_set(body,'{log}',(body->'log')||jsonb_build_array(entry));
 if octet_length(body::text)>8388608 then raise exception 'FLEET_TOO_LARGE'; end if;
 update public.fleeton_fleets set state=body,version=version+1,updated_at=now() where user_id=owner;
 return public.fleeton_get_fleet();
end $$;

-- Policies from 001 only expose an owner's own row. A former empty owner who
-- becomes a driver must not access an old full document through direct SELECT.
drop policy if exists fleeton_read_own on public.fleeton_fleets;
revoke select on public.fleeton_fleets from authenticated;
revoke all on function public.fleeton_context() from public,anon;
revoke all on function public.fleeton_save_profile(text,text) from public,anon;
revoke all on function public.fleeton_team(text,text) from public,anon;
revoke all on function public.fleeton_accept_invite() from public,anon;
revoke all on function public.fleeton_driver_trip(bigint,numeric,text,numeric,text,text,text) from public,anon;
grant execute on function public.fleeton_context(),public.fleeton_save_profile(text,text),public.fleeton_team(text,text),public.fleeton_accept_invite(),public.fleeton_driver_trip(bigint,numeric,text,numeric,text,text,text) to authenticated;
commit;
