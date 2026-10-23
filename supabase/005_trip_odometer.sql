-- Execute após 001, 002, 003 e 004. Registra o hodômetro em ambas as etapas.
begin;
create or replace function public.fleeton_driver_odometer(p_version bigint,p_car_id numeric,p_action text,p_km numeric default null,p_destination text default '',p_checklist jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare uid uuid:=auth.uid(); owner uuid; body jsonb; car jsonb; idx int; trip text; entry jsonb; last_entry int; ver bigint; thumbnail text:=''; side text;
begin
 if uid is null then raise exception 'FLEET_UNAUTHORIZED'; end if;
 if not public.fleeton_valid_inspection(p_checklist) then raise exception 'INSPECTION_INVALID'; end if;
 select owner_id into owner from public.fleeton_members where user_id=uid and role='driver' for share;
 if owner is null then raise exception 'FLEET_FORBIDDEN'; end if;
 select state,version into body,ver from public.fleeton_fleets where user_id=owner for update;
 if ver is distinct from p_version then raise exception 'FLEET_CONFLICT'; end if;
 select value,(ordinality-1)::int into car,idx from jsonb_array_elements(body->'cars') with ordinality where (value->>'id')::numeric=p_car_id;
 if car is null then raise exception 'TRIP_INVALID'; end if;
 if p_action='out' then
  if p_km is null or p_km::text in ('NaN','Infinity','-Infinity') or p_km<(car->>'km')::numeric then raise exception 'TRIP_KM'; end if;
  body:=jsonb_set(body,array['cars',idx::text,'km'],to_jsonb(p_km));
  update public.fleeton_fleets set state=body where user_id=owner;
 end if;
 trip:=case when p_action='out' then gen_random_uuid()::text else car->'uso'->>'trip_id' end;
 foreach side in array array['front','rear','left','right'] loop
  if p_checklist->'photos' ? side then thumbnail:=p_checklist->'photos'->>side;exit;end if;
 end loop;
 -- Reuses the existing locked/versioned operation and its ownership/km checks.
 -- Any later failure rolls back the entire operation, including its log/version.
 perform public.fleeton_driver_trip(p_version,p_car_id,p_action,p_km,p_destination,left((p_checklist->>'fuel')||', '||coalesce(nullif(p_checklist->>'notes',''),'Sem observações'),500),thumbnail);
 select state into body from public.fleeton_fleets where user_id=owner;
 last_entry:=jsonb_array_length(body->'log')-1;
 entry:=(body->'log'->last_entry)||jsonb_build_object('inspection',p_checklist,'km',p_km);
 if p_action='out' then entry:=entry||jsonb_build_object('km_inicio',p_km);
 elsif p_action='in' then entry:=entry||jsonb_build_object('km_inicio',car->'uso'->'kmIni','km_fim',p_km);end if;
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

revoke all on function public.fleeton_driver_odometer(bigint,numeric,text,numeric,text,jsonb) from public,anon;
grant execute on function public.fleeton_driver_odometer(bigint,numeric,text,numeric,text,jsonb) to authenticated;
revoke execute on function public.fleeton_driver_inspection(bigint,numeric,text,numeric,text,jsonb) from authenticated;
notify pgrst,'reload schema';
commit;
