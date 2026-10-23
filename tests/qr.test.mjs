import {test} from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import '../public/qr-links.js';
import '../public/fleet-insights.js';
const links=globalThis.FleetQRLinks;
test('QR usa identificadores da frota e veículo, remove credenciais e rejeita destinos inválidos',()=>{
 const link=links.url('https://fleeton.pages.dev/?code=SECRET#access_token=SECRET','owner-a',123);
 assert.equal(link,'https://fleeton.pages.dev/#vehicle=123&fleet=owner-a');
 assert.deepEqual(links.parse(link),{id:'123',owner:'owner-a'});
 assert.equal(links.parse('https://fleeton.pages.dev/#vehicle=abc&fleet=x'),null);
 assert.equal(links.parse('https://fleeton.pages.dev/#vehicle=&fleet=x'),null);
 assert.equal(links.parse('https://fleeton.pages.dev/#vehicle=123'),null);
 assert.equal(links.parse('https://fleeton.pages.dev/#access_token=test'),null);
 assert.throws(()=>links.url('javascript:alert(1)','x',1));
 assert.throws(()=>links.url('https://fleeton.pages.dev',undefined,1));
 assert.equal(globalThis.FleetInsights.matches({id:123,placa:'AAA'},{id:124}),false);
});
test('Um leitor independente decodifica o QR com margem e correção de erros',()=>{
 const link=links.url('https://fleeton.pages.dev','11111111-1111-1111-1111-111111111111',1792750000000),qr=QRCode.create(link,{errorCorrectionLevel:'M'}),scale=8,margin=4,size=(qr.modules.size+margin*2)*scale,pixels=new Uint8ClampedArray(size*size*4).fill(255);
 for(let y=0;y<qr.modules.size;y++)for(let x=0;x<qr.modules.size;x++)if(qr.modules.get(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const i=(((y+margin)*scale+dy)*size+(x+margin)*scale+dx)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}
 const decoded=jsQR(pixels,size,size);assert.equal(decoded?.data,link);
});
