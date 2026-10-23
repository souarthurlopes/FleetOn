import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/maps.js';
test('Rotas usam Maps com destino codificado e sem chave ou origem pré-definida',()=>{
 const address='Av. São João, 123, São Paulo - SP & Loja #2';
 const link=new URL(FleetMaps.url('  '+address+'  '));
 assert.equal(link.origin,'https://www.google.com');assert.equal(link.pathname,'/maps/dir/');
 assert.equal(link.searchParams.get('destination'),address);assert.equal(link.searchParams.get('api'),'1');assert.equal(link.searchParams.get('travelmode'),'driving');assert.equal(link.hash,'');
 assert.equal(FleetMaps.url(' '),'');assert.equal(FleetMaps.url(null),'');
 const untrusted=new URL(FleetMaps.url('javascript:alert(1)'));assert.equal(untrusted.origin,'https://www.google.com');assert.equal(untrusted.searchParams.get('destination'),'javascript:alert(1)');
});
