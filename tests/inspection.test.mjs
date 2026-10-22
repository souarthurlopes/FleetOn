import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/inspection-core.js';
const {validate,pair,compare}=globalThis.FleetInspection;
const sample=()=>({version:1,fuel:'Cheio',items:{exterior:'ok',interior:'not_checked',tires:'ok',lights:'ok',equipment:'ok'},notes:'',photos:{},confirmed:true});
test('Checklist exige confirmação, nível de combustível e observações se houver avaria',()=>{
 assert.ok(validate(sample()));
 assert.equal(validate({...sample(),confirmed:false}),false);
 assert.equal(validate({...sample(),fuel:''}),false);
 const damage=sample();damage.items.exterior='damage';assert.equal(validate(damage),false);
 damage.notes='Risco na porta esquerda';assert.ok(validate(damage));
 assert.equal(validate({...sample(),photos:{front:'https://example.com/a.jpg'}}),false);
 assert.equal(validate({...sample(),photos:{roof:'data:image/jpeg;base64,AAAA'}}),false);
 assert.equal(validate({...sample(),photos:{front:'data:image/jpeg;base64,'+'A'.repeat(65536)}}),false);
});
test('Comparação marca mudanças e faz o par pela viagem, preservando histórico legado',()=>{
 const start=sample(),end=sample();end.items.tires='damage';end.notes='Pneu traseiro danificado';end.fuel='1/2';
 assert.equal(compare(start,end).filter(r=>r.changed).length,1);
 const log=[{tipo:'Saída',placa:'A',trip_id:'a',inspection:start},{tipo:'Saída',placa:'A',trip_id:'b'},
 {tipo:'Devolução',placa:'A',trip_id:'a',inspection:end}];assert.equal(pair(log,2),log[0]);
 assert.equal(pair([{tipo:'Saída',placa:'A'},{tipo:'Devolução',placa:'A'}],1).tipo,'Saída');
 assert.equal(pair([{tipo:'Saída',placa:'A'},{tipo:'Devolução',placa:'A'},{tipo:'Devolução',placa:'A'}],2),null);
 assert.equal(compare(null,end),null);
 assert.equal(pair(log,0),null);
});

test('Devolução rejeita quilometragem ausente, inválida ou menor que a atual',()=>{
 const {returnKm}=globalThis.FleetInspection;
 assert.equal(returnKm('',0),null);assert.equal(returnKm(' ',0),null);
 assert.equal(returnKm('Infinity',100),null);assert.equal(returnKm('99',100),null);
 assert.equal(returnKm('0',0),0);assert.equal(returnKm('125',100),125);
});
