import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Empresa: gestor salva, motorista só lê sua frota, isolamento e validação no banco',async()=>{
 const db=new PGlite(),manager='11111111-1111-1111-1111-111111111111',driver='22222222-2222-2222-2222-222222222222',other='33333333-3333-3333-3333-333333333333';
 const identity=uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const call=async(fn,args=[])=> (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now())',[manager,'manager@test.com',driver,'driver@test.com',other,'other@test.com']);
  for(const f of ['001_fleeton.sql','002_profiles_roles.sql','006_company.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
  await db.exec('set role anon');await assert.rejects(call('fleeton_get_company'),/permission denied/);
  await db.exec('set role authenticated');await assert.rejects(call('fleeton_get_company'),/FLEET_UNAUTHORIZED/);
  await identity(manager);await call('fleeton_context');assert.equal(await call('fleeton_get_company'),null);
  const data={name:'Empresa A',cnpj:'12.345.678/0001-90',phone:'11999999999',address:'Rua Teste, 10',logo:'data:image/jpeg;base64,AAAA'};
  assert.deepEqual(await call('fleeton_save_company',[JSON.stringify(data)]),data);
  await assert.rejects(call('fleeton_save_company',[JSON.stringify({...data,name:''})]),/COMPANY_INVALID/);
  await assert.rejects(call('fleeton_save_company',[JSON.stringify({...data,cnpj:'abc'})]),/COMPANY_INVALID/);
  await assert.rejects(call('fleeton_save_company',[JSON.stringify({...data,logo:'https://other.com/logo.svg'})]),/COMPANY_INVALID/);
  await assert.rejects(call('fleeton_save_company',[JSON.stringify({...data,logo:'data:image/jpeg;base64,'+'A'.repeat(65536)})]),/COMPANY_INVALID/);
  await assert.rejects(db.query('select * from public.fleeton_companies'),/permission denied/);
  await call('fleeton_team',['invite','driver@test.com']);await identity(driver);await call('fleeton_accept_invite');
  assert.deepEqual(await call('fleeton_get_company'),data);
  await assert.rejects(call('fleeton_save_company',[JSON.stringify({...data,name:'Ataque'})]),/FLEET_FORBIDDEN/);
  await identity(other);assert.equal(await call('fleeton_get_company'),null);
  await call('fleeton_save_company',[JSON.stringify({...data,name:'Empresa B'})]);
  await identity(manager);assert.equal((await call('fleeton_get_company')).name,'Empresa A');
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/006_company.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');
  assert.deepEqual(await call('fleeton_get_company'),data);
 }finally{await db.close();}
});
