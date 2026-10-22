-- Execute uma vez no SQL Editor do seu projeto Supabase; pode ser reaplicado.
-- Não apaga frotas existentes. Conta = frota nesta primeira versão.
begin;
create table if not exists public.fleeton_fleets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  state jsonb not null default '{"cars":[],"drivers":[],"log":[],"fines":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.fleeton_fleets enable row level security;
revoke all on public.fleeton_fleets from anon, authenticated;
grant select on public.fleeton_fleets to authenticated;
drop policy if exists fleeton_read_own on public.fleeton_fleets;
create policy fleeton_read_own on public.fleeton_fleets for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.fleeton_valid_json(v jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare k text; x jsonb;
begin
  if jsonb_typeof(v) = 'object' then
    for k,x in select * from jsonb_each(v) loop
      if k = any(array['id','km','prox','kmIni','valor','litros','rodou','t','troca','vida'])
         and jsonb_typeof(x) not in ('number','null') then return false; end if;
      if k='foto' and x <> 'null'::jsonb and x <> '""'::jsonb and
         (jsonb_typeof(x)<>'string' or (x #>> '{}') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then return false; end if;
      if not public.fleeton_valid_json(x) then return false; end if;
    end loop;
  elsif jsonb_typeof(v)='array' then
    for x in select * from jsonb_array_elements(v) loop
      if not public.fleeton_valid_json(x) then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create or replace function public.fleeton_valid_state(v jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare k text; x jsonb; field text;
begin
  if jsonb_typeof(v) is distinct from 'object' or
     (select count(*) from jsonb_object_keys(v)) <> 4 then return false; end if;
  foreach k in array array['cars','drivers','log','fines'] loop
    if jsonb_typeof(v->k) is distinct from 'array' then return false; end if;
    for x in select * from jsonb_array_elements(v->k) loop
      if jsonb_typeof(x) is distinct from 'object' then return false; end if;
      if k <> 'log' and jsonb_typeof(x->'id') is distinct from 'number' then return false; end if;
      if k='cars' then
        foreach field in array array['placa','modelo'] loop
          if jsonb_typeof(x->field) is distinct from 'string' then return false; end if;
        end loop;
        if jsonb_typeof(x->'km') is distinct from 'number' or jsonb_typeof(x->'prox') is distinct from 'number' then return false; end if;
        if x ? 'pecas' and jsonb_typeof(x->'pecas') not in ('array','null') then return false; end if;
        if x ? 'uso' and jsonb_typeof(x->'uso') not in ('object','null') then return false; end if;
      elsif k='drivers' then
        if jsonb_typeof(x->'nome') is distinct from 'string' then return false; end if;
      elsif k='log' then
        foreach field in array array['placa','tipo','det','quando'] loop
          if jsonb_typeof(x->field) is distinct from 'string' then return false; end if;
        end loop;
      elsif k='fines' then
        foreach field in array array['placa','data','desc'] loop
          if jsonb_typeof(x->field) is distinct from 'string' then return false; end if;
        end loop;
      end if;
    end loop;
  end loop;
  return public.fleeton_valid_json(v);
end $$;

create or replace function public.fleeton_get_fleet()
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
  insert into public.fleeton_fleets(user_id) values (uid) on conflict do nothing;
  select jsonb_build_object('version', version, 'state', state) into result
    from public.fleeton_fleets where user_id=uid;
  return result;
end $$;

create or replace function public.fleeton_save_fleet(p_version bigint, p_state jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid := auth.uid(); next_version bigint;
begin
  if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
  if octet_length(p_state::text) > 8388608 then raise exception 'FLEET_TOO_LARGE'; end if;
  if p_state is null or not public.fleeton_valid_state(p_state) then raise exception 'FLEET_INVALID'; end if;
  update public.fleeton_fleets set state=p_state, version=version+1, updated_at=now()
    where user_id=uid and version=p_version returning version into next_version;
  if not found then raise exception 'FLEET_CONFLICT'; end if;
  return jsonb_build_object('version',next_version);
end $$;

revoke all on function public.fleeton_valid_json(jsonb) from public, anon, authenticated;
revoke all on function public.fleeton_valid_state(jsonb) from public, anon, authenticated;
revoke all on function public.fleeton_get_fleet() from public, anon;
revoke all on function public.fleeton_save_fleet(bigint,jsonb) from public, anon;
grant execute on function public.fleeton_get_fleet() to authenticated;
grant execute on function public.fleeton_save_fleet(bigint,jsonb) to authenticated;
commit;
