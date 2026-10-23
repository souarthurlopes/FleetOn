-- Execute após 001 a 005. Dados da empresa separados por frota; sem remover dados.
begin;
create table if not exists public.fleeton_companies (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.fleeton_companies enable row level security;
revoke all on public.fleeton_companies from public,anon,authenticated;

create or replace function public.fleeton_get_company()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; result jsonb;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select owner_id into owner from public.fleeton_members where user_id=uid;
 select data into result from public.fleeton_companies where owner_id=coalesce(owner,uid);
 return result;
end $$;

create or replace function public.fleeton_save_company(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); member public.fleeton_members; k text; cleaned jsonb:='{}'::jsonb;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 select * into member from public.fleeton_members where user_id=uid for update;
 if member.role='driver' or (member.owner_id is not null and member.owner_id<>uid) then raise exception 'FLEET_FORBIDDEN'; end if;
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
 insert into public.fleeton_companies(owner_id,data) values(uid,cleaned)
 on conflict(owner_id) do update set data=excluded.data,updated_at=now();
 return cleaned;
end $$;
revoke all on function public.fleeton_get_company(),public.fleeton_save_company(jsonb) from public,anon;
grant execute on function public.fleeton_get_company(),public.fleeton_save_company(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
