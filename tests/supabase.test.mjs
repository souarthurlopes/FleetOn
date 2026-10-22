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
  const state={cars:[{id:1,placa:'ABC1234',modelo:'Teste',km:100,prox:10000,uso:null}],drivers:[],log:[],fines:[]};
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
