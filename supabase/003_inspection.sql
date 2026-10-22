-- Execute após 001 e 002. Não remove contas, fotos ou registros antigos.
begin;
create or replace function public.fleeton_valid_inspection(v jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare key text; photo jsonb;
begin
 if jsonb_typeof(v) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(v))<>6 or not (v ?& array['version','fuel','items','notes','photos','confirmed']) then return false; end if;
 if v->'version' is distinct from '1'::jsonb or v->'confirmed' is distinct from 'true'::jsonb then return false; end if;
 if jsonb_typeof(v->'fuel') is distinct from 'string' or not (v->>'fuel'=any(array['Cheio','3/4','1/2','1/4','Reserva'])) then return false; end if;
 if jsonb_typeof(v->'notes') is distinct from 'string' or length(v->>'notes')>1000 then return false; end if;
 if jsonb_typeof(v->'items') is distinct from 'object' or jsonb_typeof(v->'photos') is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(v->'items'))<>5 then return false; end if;
 foreach key in array array['exterior','interior','tires','lights','equipment'] loop
  if jsonb_typeof(v->'items'->key) is distinct from 'string' or not (v->'items'->>key=any(array['ok','damage','not_checked'])) then return false; end if;
  if v->'items'->>key='damage' and length(trim(v->>'notes'))=0 then return false; end if;
 end loop;
 if (select count(*) from jsonb_object_keys(v->'photos'))>4 then return false; end if;
 for key,photo in select * from jsonb_each(v->'photos') loop
  if not (key=any(array['front','rear','left','right'])) or jsonb_typeof(photo)<>'string' or octet_length(photo#>>'{}')>65536 or (photo#>>'{}') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then return false; end if;
 end loop;
 return true;
end $$;

create or replace function public.fleeton_driver_inspection(p_version bigint,p_car_id numeric,p_action text,p_km numeric default null,p_destination text default '',p_checklist jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; body jsonb; car jsonb; idx int; trip text; entry jsonb; last_entry int; thumbnail text:=''; side text;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 if not public.fleeton_valid_inspection(p_checklist) then raise exception 'INSPECTION_INVALID'; end if;
 select owner_id into owner from public.fleeton_members where user_id=uid and role='driver' for share;
 if owner is null then raise exception 'FLEET_FORBIDDEN'; end if;
 select state into body from public.fleeton_fleets where user_id=owner for update;
 select value,(ordinality-1)::int into car,idx from jsonb_array_elements(body->'cars') with ordinality where (value->>'id')::numeric=p_car_id;
 if car is null then raise exception 'TRIP_INVALID'; end if;
 trip:=case when p_action='out' then gen_random_uuid()::text else car->'uso'->>'trip_id' end;
 foreach side in array array['front','rear','left','right'] loop
  if p_checklist->'photos' ? side then thumbnail:=p_checklist->'photos'->>side;exit;end if;
 end loop;
 -- Reuses the existing locked/versioned operation and its ownership/km checks.
 -- Any later failure rolls back the entire operation, including its log/version.
 perform public.fleeton_driver_trip(p_version,p_car_id,p_action,p_km,p_destination,left((p_checklist->>'fuel')||', '||coalesce(nullif(p_checklist->>'notes',''),'Sem observações'),500),thumbnail);
 select state into body from public.fleeton_fleets where user_id=owner;
 last_entry:=jsonb_array_length(body->'log')-1;
 entry:=(body->'log'->last_entry)||jsonb_build_object('inspection',p_checklist);
 if trip is not null then entry:=entry||jsonb_build_object('trip_id',trip);end if;
 body:=jsonb_set(body,array['log',last_entry::text],entry);
 if p_action='out' then
  car:=body->'cars'->idx;
  car:=jsonb_set(car,'{uso}',(car->'uso')||jsonb_build_object('trip_id',trip,'inspection_summary',jsonb_build_object('fuel',p_checklist->'fuel','items',p_checklist->'items','notes',p_checklist->'notes')));
  body:=jsonb_set(body,array['cars',idx::text],car);
 end if;
 if octet_length(body::text)>8388608 then raise exception 'FLEET_TOO_LARGE'; end if;
 update public.fleeton_fleets set state=body where user_id=owner;
 return public.fleeton_get_fleet();
end $$;
revoke all on function public.fleeton_valid_inspection(jsonb) from public,anon,authenticated;
revoke all on function public.fleeton_driver_inspection(bigint,numeric,text,numeric,text,jsonb) from public,anon;
grant execute on function public.fleeton_driver_inspection(bigint,numeric,text,numeric,text,jsonb) to authenticated;
-- Old clients cannot bypass inspection validation via the old trip endpoint.
revoke execute on function public.fleeton_driver_trip(bigint,numeric,text,numeric,text,text,text) from authenticated;
notify pgrst,'reload schema';
commit;
