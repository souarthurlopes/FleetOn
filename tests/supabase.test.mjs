import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Migração PostgreSQL: isolamento RLS, RPC, conflito, validação e reaplicação', async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated,anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');`);
  const sql=await readFile(new URL('../supabase/001_fleeton.sql',import.meta.url),'utf8');
  await db.exec(sql);
  await db.exec(`set role anon`);
  await assert.rejects(db.query('select public.fleeton_get_fleet()'),/permission denied/);
  await db.exec(`set role authenticated`);
  await assert.rejects(db.query('select public.fleeton_get_fleet()'),/FLEET_UNAUTHORIZED/);
  await db.exec(`select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)`);
  let result=await db.query('select public.fleeton_get_fleet() as fleet');
  assert.deepEqual(result.rows[0].fleet,{version:0,state:{cars:[],drivers:[],log:[],fines:[]}});
  const state={cars:[{id:1,placa:'ABC1234',modelo:'Teste',km:100,prox:10000,uso:null}],drivers:[],log:[],fines:[{id:1,placa:'ABC1234',data:'2026-10-23T10:00',vencimento:'2026-11-20',valor:100,desc:'Multa de teste',pago:false}]};
  result=await db.query('select public.fleeton_save_fleet($1,$2) as saved',[0,JSON.stringify(state)]);
  assert.equal(result.rows[0].saved.version,1);
  await assert.rejects(db.query('select public.fleeton_save_fleet($1,$2)',[0,JSON.stringify(state)]),/FLEET_CONFLICT/);
  await assert.rejects(db.query('update public.fleeton_fleets set version=99'),/permission denied/);
  await assert.rejects(db.query('insert into public.fleeton_fleets(user_id) values (auth.uid())'),/permission denied/);
  await assert.rejects(db.query('select public.fleeton_save_fleet($1,$2)',[1,JSON.stringify({...state,cars:[{id:'<script>'}]})]),/FLEET_INVALID/);
  await assert.rejects(db.query('select public.fleeton_save_fleet($1,$2)',[1,null]),/FLEET_INVALID/);
  await db.exec(`select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false)`);
  assert.equal((await db.query('select * from public.fleeton_fleets')).rows.length,0);
  assert.equal((await db.query('select public.fleeton_get_fleet() as fleet')).rows[0].fleet.state.cars.length,0);
  await db.exec('reset role');await db.exec(sql);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)`);
  result=await db.query('select public.fleeton_get_fleet() as fleet');
  assert.deepEqual(result.rows[0].fleet.state,state);
 } finally {await db.close();}
});

test('Perfis e equipe: motorista não se promove, acessa outra frota ou altera finanças',async()=>{
 const db=new PGlite();
 const manager='11111111-1111-1111-1111-111111111111',driver='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333';
 const identity=async uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const call=async(fn,args=[])=> (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now()),($5,$6,now())',[manager,'manager@test.com',driver,'driver@test.com',other,'other@test.com']);
  await db.exec(await readFile(new URL('../supabase/001_fleeton.sql',import.meta.url),'utf8'));
  const migration=await readFile(new URL('../supabase/002_profiles_roles.sql',import.meta.url),'utf8');await db.exec(migration);
  await db.exec('set role anon');await assert.rejects(call('fleeton_context'),/permission denied/);
  await db.exec('set role authenticated');await identity(manager);
  assert.equal((await call('fleeton_context')).role,'manager');await call('fleeton_get_fleet');
  const state={cars:[{id:1,placa:'ABC1234',modelo:'Teste',km:100,prox:10000,uso:null,seg:'2027-01-01'}],drivers:[],log:[{tipo:'Abastecimento',placa:'ABC1234',det:'Segredo financeiro',quando:'Hoje',valor:1000}],fines:[]};
  await call('fleeton_save_fleet',[0,JSON.stringify(state)]);
  await call('fleeton_save_profile',['Gestor','']);await call('fleeton_team',['invite','driver@test.com']);
  await identity(other);assert.equal((await call('fleeton_context')).invitation,null);
  await assert.rejects(call('fleeton_accept_invite'),/TEAM_NO_INVITE/);
  await identity(driver);assert.equal((await call('fleeton_context')).invitation.email,'manager@test.com');
  assert.equal((await call('fleeton_accept_invite')).role,'driver');
  assert.equal((await call('fleeton_save_profile',['Ana',''])).name,'Ana');
  await assert.rejects(db.query("insert into public.fleeton_members values ($1,$1,'manager')",[driver]),/permission denied/);
  await assert.rejects(db.query('select * from public.fleeton_fleets'),/permission denied/);
  await assert.rejects(call('fleeton_team',['invite','other@test.com']),/FLEET_FORBIDDEN/);
  await assert.rejects(call('fleeton_save_fleet',[1,JSON.stringify(state)]),/FLEET_FORBIDDEN/);
  let fleet=await call('fleeton_get_fleet');assert.equal(fleet.state.log.length,0);assert.equal(fleet.state.cars[0].seg,undefined);assert.equal(fleet.state.drivers[0].nome,'Ana');
  await assert.rejects(call('fleeton_save_profile',['Ana','https://example.com/avatar.png']),/PROFILE_INVALID/);
  await identity(manager);await call('fleeton_team',['invite','other@test.com']);
  await identity(other);await call('fleeton_accept_invite');
  await identity(driver);
  fleet=await call('fleeton_driver_trip',[1,1,'out',null,'Cliente','Cheio, sem avarias','']);
  assert.equal(fleet.state.cars[0].uso.user_id,driver);
  await assert.rejects(call('fleeton_driver_trip',[1,1,'in',120,'','','']),/FLEET_CONFLICT/);
  await assert.rejects(call('fleeton_driver_trip',[2,1,'in',90,'','','']),/TRIP_KM/);
  await identity(other);await assert.rejects(call('fleeton_driver_trip',[2,1,'in',120,'','','']),/FLEET_FORBIDDEN/);
  await identity(manager);await assert.rejects(call('fleeton_team',['remove','driver@test.com']),/TEAM_ACTIVE_TRIP/);
  fleet=await call('fleeton_get_fleet');assert.equal(fleet.state.log.length,2);assert.equal(fleet.state.log[1].tipo,'Saída');assert.equal(fleet.state.log[0].valor,1000);
  await identity(driver);fleet=await call('fleeton_driver_trip',[2,1,'in',125,'','1/2, sem avarias','']);assert.equal(fleet.state.cars[0].km,125);
  await identity(manager);await call('fleeton_team',['remove','driver@test.com']);
  await identity(driver);await assert.rejects(call('fleeton_driver_trip',[3,1,'out',null,'Destino','','']),/FLEET_FORBIDDEN/);
  assert.equal((await call('fleeton_get_fleet')).state.cars.length,0);
  await db.exec('reset role');await db.exec(migration);await db.exec('set role authenticated');await identity(manager);
  assert.equal((await call('fleeton_context')).profile.name,'Gestor');assert.equal((await call('fleeton_get_fleet')).state.cars[0].km,125);
 }finally{await db.close();}
});

test('Checklist do motorista é obrigatório, versionado e preserva as fotos e a identidade da viagem',async()=>{
 const db=new PGlite(),manager='11111111-1111-1111-1111-111111111111',driver='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333';
 const identity=uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const call=async(fn,args=[])=> (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 const checklist={version:1,fuel:'Cheio',items:{exterior:'ok',interior:'not_checked',tires:'ok',lights:'ok',equipment:'ok'},notes:'',photos:{front:'data:image/jpeg;base64,AAAA'},confirmed:true};
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[manager,'manager@test.com',driver,'driver@test.com',other,'other@test.com']);
  for(const file of ['001_fleeton.sql','002_profiles_roles.sql','003_inspection.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
  await db.exec('set role anon');await assert.rejects(call('fleeton_driver_inspection',[0,1,'out',null,'Destino',JSON.stringify(checklist)]),/permission denied/);
  await db.exec('set role authenticated');await identity(manager);await call('fleeton_context');await call('fleeton_get_fleet');
  await call('fleeton_save_fleet',[0,JSON.stringify({cars:[{id:1,placa:'ABC1234',modelo:'Teste',km:100,prox:10000,uso:null}],drivers:[],log:[],fines:[]})]);
  await call('fleeton_team',['invite','driver@test.com']);await call('fleeton_team',['invite','other@test.com']);
  await identity(other);await call('fleeton_accept_invite');await identity(driver);await call('fleeton_accept_invite');
  await assert.rejects(call('fleeton_driver_trip',[1,1,'out',null,'Destino','','']),/permission denied/);
  await assert.rejects(call('fleeton_driver_inspection',[1,1,'out',null,'Destino',JSON.stringify({...checklist,confirmed:false})]),/INSPECTION_INVALID/);
  assert.equal((await call('fleeton_get_fleet')).version,1);
  let fleet=await call('fleeton_driver_inspection',[1,1,'out',null,'Destino',JSON.stringify(checklist)]);
  assert.equal(fleet.version,2);assert.equal(fleet.state.log.length,0);assert.equal(fleet.state.cars[0].uso.inspection_summary.fuel,'Cheio');
  await identity(other);await assert.rejects(call('fleeton_driver_inspection',[2,1,'in',125,'',JSON.stringify(checklist)]),/FLEET_FORBIDDEN/);
  await identity(driver);await assert.rejects(call('fleeton_driver_inspection',[1,1,'in',125,'',JSON.stringify(checklist)]),/FLEET_CONFLICT/);
  const end={...checklist,fuel:'1/2',items:{...checklist.items,tires:'damage'},notes:'Pneu traseiro com dano',photos:{rear:'data:image/jpeg;base64,BBBB'}};
  fleet=await call('fleeton_driver_inspection',[2,1,'in',125,'',JSON.stringify(end)]);assert.equal(fleet.version,3);assert.equal(fleet.state.cars[0].uso,null);
  await identity(manager);fleet=await call('fleeton_get_fleet');
  assert.equal(fleet.state.log.length,2);assert.deepEqual(fleet.state.log[0].inspection,checklist);assert.deepEqual(fleet.state.log[1].inspection,end);
  assert.equal(fleet.state.log[0].trip_id,fleet.state.log[1].trip_id);assert.equal(fleet.state.log[1].user_id,driver);assert.equal(fleet.state.log[1].rodou,25);
  await assert.rejects(call('fleeton_driver_inspection',[3,1,'out',null,'Destino',JSON.stringify(checklist)]),/FLEET_FORBIDDEN/);
  await identity(driver);await assert.rejects(call('fleeton_driver_inspection',[3,1,'out',null,'Destino',JSON.stringify({...checklist,photos:{front:'data:image/jpeg;base64,'+'A'.repeat(65536)}})]),/INSPECTION_INVALID/);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/003_inspection.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');await identity(manager);
  assert.equal((await call('fleeton_get_fleet')).state.log.length,2);
  // A failure after the old trip operation must roll back its log, use and version.
  const almostFull={cars:[{id:1,placa:'ABC1234',modelo:'Teste',km:125,prox:10000,uso:null}],drivers:[],log:[{tipo:'Nota',placa:'ABC1234',det:'x'.repeat(8388608-210000),quando:'Hoje'}],fines:[]};
  await call('fleeton_save_fleet',[3,JSON.stringify(almostFull)]);
  const image='data:image/jpeg;base64,'+'A'.repeat(60000);
  await identity(driver);
  await assert.rejects(call('fleeton_driver_inspection',[4,1,'out',null,'Destino',JSON.stringify({...checklist,photos:{front:image,rear:image,left:image,right:image}})]),/FLEET_TOO_LARGE/);
  await identity(manager);fleet=await call('fleeton_get_fleet');
  assert.equal(fleet.version,4);assert.equal(fleet.state.cars[0].uso,null);assert.equal(fleet.state.log.length,1);
 }finally{await db.close();}
});

test('Consulta de sincronização expõe somente versão/cargo da própria frota e mantém acesso restrito',async()=>{
 const db=new PGlite(),manager='11111111-1111-1111-1111-111111111111',driver='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333';
 const identity=uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const call=async(fn,args=[])=> (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[manager,'manager@test.com',driver,'driver@test.com',other,'other@test.com']);
  for(const file of ['001_fleeton.sql','002_profiles_roles.sql','003_inspection.sql','004_auto_sync.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
  await db.exec('set role anon');await assert.rejects(call('fleeton_sync_status'),/permission denied/);
  await db.exec('set role authenticated');await assert.rejects(call('fleeton_sync_status'),/FLEET_UNAUTHORIZED/);
  await identity(manager);await call('fleeton_context');await call('fleeton_get_fleet');
  await call('fleeton_save_fleet',[0,JSON.stringify({cars:[],drivers:[],log:[{tipo:'Despesa',placa:'ABC',quando:'Hoje',det:'Informação privada',valor:999}],fines:[]})]);
  assert.deepEqual(await call('fleeton_sync_status'),{version:1,role:'manager',owner_id:manager});
  await call('fleeton_team',['invite','driver@test.com']);await identity(driver);await call('fleeton_accept_invite');
  assert.deepEqual(await call('fleeton_sync_status'),{version:1,role:'driver',owner_id:manager});
  await identity(other);assert.deepEqual(await call('fleeton_sync_status'),{version:0,role:'manager',owner_id:other});
  await assert.rejects(db.query('select * from public.fleeton_fleets'),/permission denied/);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/004_auto_sync.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');await identity(manager);
  assert.equal((await call('fleeton_get_fleet')).state.log[0].valor,999);
 }finally{await db.close();}
});

test('Hodômetro registra km de retirada/devolução e calcula somente o percurso da viagem',async()=>{
 const db=new PGlite(),manager='11111111-1111-1111-1111-111111111111',driver='22222222-2222-2222-2222-222222222222';
 const identity=uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const call=async(fn,args=[])=> (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 const checklist={version:1,fuel:'Cheio',items:{exterior:'ok',interior:'ok',tires:'ok',lights:'ok',equipment:'ok'},notes:'',photos:{},confirmed:true};
 const trip=(version,action,km)=>call('fleeton_driver_odometer',[version,1,action,km,'Destino',JSON.stringify(checklist)]);
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[manager,'manager@test.com',driver,'driver@test.com']);
  for(const file of ['001_fleeton.sql','002_profiles_roles.sql','003_inspection.sql','004_auto_sync.sql','005_trip_odometer.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
  await db.exec('set role anon');await assert.rejects(trip(1,'out',110),/permission denied/);
  await db.exec('set role authenticated');await identity(manager);await call('fleeton_context');await call('fleeton_get_fleet');
  await call('fleeton_save_fleet',[0,JSON.stringify({cars:[{id:1,placa:'ABC1234',modelo:'Teste',km:100,prox:10000,uso:null}],drivers:[],log:[],fines:[]})]);
  await call('fleeton_team',['invite','driver@test.com']);await identity(driver);await call('fleeton_accept_invite');
  await assert.rejects(trip(1,'out',null),/TRIP_KM/);await assert.rejects(trip(1,'out',99),/TRIP_KM/);
  assert.equal((await call('fleeton_get_fleet')).state.cars[0].km,100);
  await assert.rejects(call('fleeton_driver_inspection',[1,1,'out',110,'Destino',JSON.stringify(checklist)]),/permission denied/);
  let result=await trip(1,'out',110);assert.equal(result.state.cars[0].uso.kmIni,110);assert.equal(result.state.cars[0].km,110);
  await assert.rejects(trip(2,'in',109),/TRIP_KM/);
  await trip(2,'in',125);await identity(manager);result=await call('fleeton_get_fleet');
  assert.equal(result.state.log[0].km,110);assert.equal(result.state.log[1].km_inicio,110);assert.equal(result.state.log[1].km_fim,125);assert.equal(result.state.log[1].rodou,15);
  assert.equal(result.state.cars[0].km,125);assert.equal(result.state.cars[0].uso,null);
  await assert.rejects(trip(3,'out',130),/FLEET_FORBIDDEN/);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/005_trip_odometer.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');await identity(manager);
  assert.equal((await call('fleeton_get_fleet')).state.log.length,2);
 }finally{await db.close();}
});
