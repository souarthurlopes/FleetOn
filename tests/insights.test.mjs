import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/fleet-insights.js';
const {daysUntil,dateAlert,kmAlert,collect,matches}=globalThis.FleetInsights;
const now=new Date('2026-10-22T15:00:00Z');
test('Vencimentos seguem o calendário de Brasília, incluindo hoje e os limites de 30 dias',()=>{
 assert.equal(daysUntil('2026-10-22',now),0);
 assert.equal(dateAlert('Seguro','2026-10-22',now).title,'Seguro vence hoje');
 assert.equal(dateAlert('IPVA','2026-10-21',now).severity,'urgent');
 assert.equal(dateAlert('CNH','2026-11-21',now).days,30);
 assert.equal(dateAlert('CNH','2026-11-22',now),null);
 assert.equal(daysUntil('2026-10-22',new Date('2026-10-23T01:30:00Z')),0);
 assert.equal(daysUntil('2026-10-22',new Date('2026-10-23T03:01:00Z')),-1);
 assert.equal(daysUntil('2026-02-30',now),null);
 assert.equal(daysUntil('',now),null);
 assert.equal(dateAlert('CNH','inválido',now),null);
 assert.equal(daysUntil('2028-02-29',new Date('2028-02-28T15:00:00Z')),1);
});
test('Revisões e peças respeitam os limites de quilometragem sem alertas por dados ausentes',()=>{
 assert.equal(kmAlert('Revisão',10000,9499),null);
 assert.equal(kmAlert('Revisão',10000,9500).remaining,500);
 assert.equal(kmAlert('Revisão',10000,10000).severity,'urgent');
 assert.equal(kmAlert('Revisão',10000,10001).remaining,-1);
 assert.equal(kmAlert('Revisão',null,10000),null);
 assert.equal(kmAlert('Revisão',0,10000),null);
 const alerts=collect({cars:[{id:1,placa:'ABC',km:39100,prox:50000,pecas:[{troca:0,vida:40000}]}],drivers:[]},now);
 assert.equal(alerts.length,1);assert.equal(alerts[0].remaining,900);
});
test('Central mantém pendências independentes e busca combina filtros sem depender de acentos/hífens',()=>{
 const cars=[{id:1,placa:'ABC-1D23',modelo:'Fiat Strada',km:100,prox:10000,ipva:'2026-10-21',seg:'2026-10-22',uso:null},
 {id:2,placa:'XYZ-4567',modelo:'Saveiro',km:100,prox:10000,uso:{mot:'João da Silva'}},
 {id:3,placa:'REV1234',modelo:'Fiorino',km:9500,prox:10000,uso:null}];
 const alerts=collect({cars,drivers:[{id:5,nome:'Ana',cnh:'2026-10-23'}]},now);
 assert.equal(alerts.length,4);assert.equal(alerts.filter(a=>a.severity==='urgent').length,2);
 assert.equal(alerts[0].subject,'ABC-1D23');assert.equal(alerts[3].category,'maintenance');
 assert.ok(matches(cars[0],{query:'abc1d23'},now));
 assert.ok(matches(cars[1],{query:'joao da silva',status:'inuse',driver:'João da Silva'},now));
 assert.ok(!matches(cars[1],{status:'available'},now));
 assert.ok(!matches(cars[0],{driver:'João da Silva'},now));
 assert.equal(cars.filter(c=>matches(c,{status:'attention'},now)).length,2);
 assert.equal(cars.filter(c=>matches(c,{query:'não existe'},now)).length,0);
});
