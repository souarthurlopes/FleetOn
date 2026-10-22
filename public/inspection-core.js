(function(root){
 const sides={front:'Frente',rear:'Traseira',left:'Lateral esquerda',right:'Lateral direita'};
 const items={exterior:'Lataria e vidros',interior:'Interior e limpeza',tires:'Pneus',lights:'Luzes e sinalização',equipment:'Equipamentos de segurança'};
 const statuses={ok:'Sem avaria',damage:'Com avaria',not_checked:'Não conferido'};
 const fuels=['Cheio','3/4','1/2','1/4','Reserva'];
 const photo=(value,limit=65536)=>typeof value==='string'&&value.length<=limit&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);
 function validate(value){
  if(!value||Object.keys(value).length!==6||value.version!==1||value.confirmed!==true||!fuels.includes(value.fuel)||typeof value.notes!=='string'||value.notes.length>1000)return false;
  if(!value.items||Object.keys(value.items).length!==5||Object.keys(items).some(k=>!Object.hasOwn(statuses,value.items[k])))return false;
  if(Object.values(value.items).includes('damage')&&!value.notes.trim())return false;
  if(!value.photos||Array.isArray(value.photos)||typeof value.photos!=='object'||Object.keys(value.photos).length>4)return false;
  return Object.entries(value.photos).every(([k,v])=>Object.hasOwn(sides,k)&&photo(v));
 }
 function pair(log,index){
  const entry=log[index];if(!entry||entry.tipo!=='Devolução')return null;
  for(let i=index-1;i>=0;i--){const item=log[i];if(item.placa!==entry.placa)continue;
   if(entry.trip_id){if(item.tipo==='Saída'&&item.trip_id===entry.trip_id)return item;}
   else {if(item.tipo==='Devolução')return null;if(item.tipo==='Saída')return item;}
  }return null;
 }
 function compare(start,end){
  if(!validate(start)||!validate(end))return null;
  return Object.keys(items).map(key=>({key,label:items[key],before:start.items[key],after:end.items[key],changed:start.items[key]!==end.items[key]}));
 }
 function returnKm(raw,current){const value=Number(raw);return typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(value)&&Number.isFinite(current)&&value>=current?value:null;}
 root.FleetInspection={sides,items,statuses,fuels,photo,validate,pair,compare,returnKm};
})(globalThis);
