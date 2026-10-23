import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/inspection-core.js';
import '../public/fleet-insights.js';
import '../public/reports-core.js';
const R=globalThis.FleetReports;
const t=s=>Date.parse('2026-10-10T'+s+'-03:00');
const fixture=()=>({cars:[{placa:'AAA',modelo:'Uno',uso:null}],log:[
 {tipo:'Saída',placa:'AAA',trip_id:'one',user_id:'ana',det:'Ana → Cliente',km:110,t:t('08:00')},
 {tipo:'Abastecimento',placa:'AAA',valor:100.10,litros:20,t:t('09:00'),det:'Posto'},
 {tipo:'Devolução',placa:'AAA',trip_id:'one',user_id:'ana',det:'Ana rodou 15 km',km:125,t:t('10:00')},
 {tipo:'Revisão',placa:'AAA',valor:200.20,t:t('11:00')},
 {tipo:'Outro',placa:'REMOVED',valor:0.10,t:Date.parse('2026-10-11T01:00Z'),det:'=HYPERLINK("bad")\nOutro'}],
 fines:[{placa:'AAA',data:'2026-10-10T09:30',valor:50,pago:false},{placa:'AAA',data:'2026-10-10',valor:25,pago:true}]});
test('Relatórios usam Brasília, não inventam horário e incluem limites de datas',()=>{
 assert.equal(R.dayOf(Date.parse('2026-10-11T01:00Z')),'2026-10-10');
 assert.equal(R.fineTime('2026-10-10T09:30'),t('09:30'));
 assert.ok(Number.isNaN(R.fineTime('2026-02-30T12:00')));
 const rows=R.rows(fixture());assert.equal(R.filter(rows,{from:'2026-10-10',to:'2026-10-10'}).length,7);
 assert.equal(R.filter(rows,{from:'2026-10-11'}).length,0);
 assert.equal(rows.find(r=>r.source==='fine'&&r.payment==='Paga').driverKey,'');
});
test('Custos são atribuídos somente dentro de uma viagem identificada e filtros combinam',()=>{
 const rows=R.rows(fixture());
 assert.equal(rows.find(r=>r.kind==='fuel').driverKey,'u:ana');
 assert.equal(rows.find(r=>r.kind==='maintenance').driverKey,'');
 assert.equal(rows.find(r=>r.payment==='Pendente').driverKey,'u:ana');
 assert.equal(R.filter(rows,{driver:'u:ana',vehicle:'AAA',kind:'fuel'}).length,1);
 assert.equal(R.filter(rows,{driver:'unknown'}).length,3);
 assert.deepEqual(R.summary(rows),{amount:375.4,distance:15,trips:1,liters:20,records:7});
 const state=fixture();state.log.splice(1,0,{tipo:'Saída',placa:'AAA',trip_id:'two',det:'Bia → Outro',t:t('08:30')});state.cars[0].uso={trip_id:'two',mot:'Bia'};
 assert.equal(R.rows(state).find(r=>r.kind==='fuel').driverKey,'');
});
test('CSV exporta todos os registros, escapa texto e bloqueia fórmulas de planilha',()=>{
 const csv=R.csv(R.rows(fixture()));assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('375')===false);
 assert.ok(csv.includes('"\'=HYPERLINK(""bad"")\nOutro"'));assert.ok(csv.includes('100,1'));
 assert.ok(R.csv(R.rows(fixture()),{name:'=EMPRESA',cnpj:'12345678000190'}).includes("\"'=EMPRESA\""));
 const rows=Array.from({length:101},()=>R.rows(fixture())[0]);assert.equal(R.csv(rows).split('\r\n').length,102);
});
