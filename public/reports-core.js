(function(root){
 const TZ='America/Sao_Paulo';
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 const numeric=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
 function dayOf(time){
  if(!Number.isFinite(time))return '';
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  const get=k=>p.find(x=>x.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;
 }
 function fineTime(value){
  if(typeof value!=='string')return NaN;
  if(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value))return Date.parse(value);
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);if(!m)return NaN;
  const [,y,mo,d,h,mi,se='0']=m,wanted=Date.UTC(+y,+mo-1,+d,+h,+mi,+se);
  if(+h>23||+mi>59||+se>59)return NaN;
  const check=new Date(wanted);if(check.getUTCFullYear()!==+y||check.getUTCMonth()!==+mo-1||check.getUTCDate()!==+d)return NaN;
  let result=wanted;
  for(let i=0;i<3;i++){
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result));
   const get=k=>Number(parts.find(x=>x.type===k).value);
   const local=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));
   const delta=wanted-local;if(!delta)break;result+=delta;
  }return result;
 }
 function identity(name,user){name=String(name||'').trim();return name||user?{key:user?'u:'+user:'n:'+normalize(name),name:name||'Motorista sem nome'}:{key:'',name:'Não identificado'};}
 function tripDriver(log){
  let name=log.motorista;
  if(!name&&log.tipo==='Saída')name=String(log.det||'').split(' → ')[0];
  if(!name&&log.tipo==='Devolução')name=String(log.det||'').split(' rodou ')[0];
  return identity(name,log.user_id);
 }
 function category(type){const n=normalize(type);
  if(['saida','devolucao'].includes(n))return 'trips';
  if(n==='abastecimento')return 'fuel';
  if(['manutencao','troca de oleo','revisao','pneus','troca de peca'].includes(n))return 'maintenance';
  if(n==='multa')return 'fines';return 'other';
 }
 function rows(state){
  const logs=state.log||[],ranges=[];
  logs.forEach((end,index)=>{
   if(end.tipo!=='Devolução')return;
   const start=root.FleetInspection.pair(logs,index);
   if(start&&numeric(start.t)!==null&&numeric(end.t)!==null&&start.t<=end.t)ranges.push({plate:end.placa,start:start.t,end:end.t,driver:tripDriver(start),startIndex:logs.indexOf(start),endIndex:index});
  });
  for(const car of state.cars||[]){if(!car.uso)continue;
   let index=-1;for(let i=logs.length-1;i>=0;i--){const l=logs[i];if(l.tipo!=='Saída'||l.placa!==car.placa)continue;
    if(car.uso.trip_id?l.trip_id===car.uso.trip_id:tripDriver(l).name===car.uso.mot){index=i;break;}}
   if(index>=0&&numeric(logs[index].t)!==null)ranges.push({plate:car.placa,start:logs[index].t,end:Infinity,driver:tripDriver(logs[index]),startIndex:index,endIndex:Infinity});
  }
  const byPlate=new Map();for(const range of ranges){if(!byPlate.has(range.plate))byPlate.set(range.plate,[]);byPlate.get(range.plate).push(range);}
  const responsible=(plate,time,index=Infinity)=>{
   if(!Number.isFinite(time))return identity('');
   const possible=(byPlate.get(plate)||[]).filter(r=>time>=r.start&&time<=r.end&&(time!==r.start||index>=r.startIndex)&&(time!==r.end||index<=r.endIndex));
   const unique=new Map(possible.map(r=>[r.driver.key,r.driver]));return unique.size===1?[...unique.values()][0]:identity('');
  };
  const model=plate=>(state.cars||[]).find(c=>c.placa===plate)?.modelo||'';
  const result=logs.map((l,index)=>{
   const kind=category(l.tipo),time=numeric(l.t)??NaN,driver=kind==='trips'?tripDriver(l):l.motorista?identity(l.motorista):responsible(l.placa,time,index);
   const start=l.tipo==='Devolução'?root.FleetInspection.pair(logs,index):null;
   const kmStart=numeric(l.km_inicio)??(l.tipo==='Saída'?numeric(l.km):numeric(start?.km_inicio)??numeric(start?.km));
   const kmEnd=l.tipo==='Devolução'?(numeric(l.km_fim)??numeric(l.km)):null;
   const distance=l.tipo==='Devolução'?(numeric(l.rodou)??(kmStart!==null&&kmEnd!==null&&kmEnd>=kmStart?kmEnd-kmStart:null)):null;
   return {id:'log:'+index,index,source:'log',time,day:dayOf(time),plate:String(l.placa||''),model:model(l.placa),kind,type:String(l.tipo||'Outro'),driver:driver.name,driverKey:driver.key,kmStart,kmEnd,distance:distance!==null&&distance>=0?distance:null,liters:numeric(l.litros),amount:numeric(l.valor),description:String(l.det||''),payment:'',entry:l};
  });
  for(const [index,f] of (state.fines||[]).entries()){
   const time=fineTime(f.data),dateOnly=typeof f.data==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(f.data)&&root.FleetInsights.civilDay(f.data)!==null?f.data:'';
   const driver=f.motorista?identity(f.motorista):responsible(f.placa,time);
   result.push({id:'fine:'+index,index,source:'fine',time,day:dayOf(time)||dateOnly,plate:String(f.placa||''),model:model(f.placa),kind:'fines',type:'Multa',driver:driver.name,driverKey:driver.key,kmStart:null,kmEnd:null,distance:null,liters:null,amount:numeric(f.valor),description:String(f.desc||''),payment:f.pago?'Paga':'Pendente',entry:f});
  }
  return result.sort((a,b)=>(Number.isFinite(b.time)?b.time:-Infinity)-(Number.isFinite(a.time)?a.time:-Infinity)||a.id.localeCompare(b.id));
 }
 function filter(rows,selection){return rows.filter(r=>(!selection.from||r.day&&r.day>=selection.from)&&(!selection.to||r.day&&r.day<=selection.to)&&(!selection.vehicle||r.plate===selection.vehicle)&&(!selection.driver||(selection.driver==='unknown'?!r.driverKey:r.driverKey===selection.driver))&&(!selection.kind||selection.kind==='all'||r.kind===selection.kind));}
 function summary(rows){
  const cents=rows.reduce((sum,r)=>sum+(r.amount===null?0:Math.round(r.amount*100)),0);
  return {amount:cents/100,distance:rows.reduce((n,r)=>n+(r.distance??0),0),trips:rows.filter(r=>r.type==='Devolução').length,liters:rows.reduce((n,r)=>n+(r.liters??0),0),records:rows.length};
 }
 function csvCell(value){
  if(typeof value==='number')return Number.isFinite(value)?String(value).replace('.',','):'';
  let text=String(value??'');if(/^[\s]*[=+\-@]|^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
 }
 function timeLabel(row){return Number.isFinite(row.time)?new Date(row.time).toLocaleString('pt-BR',{timeZone:TZ,dateStyle:'short',timeStyle:'short'}):row.day?row.day.split('-').reverse().join('/'):'Sem data válida';}
 function csv(rows){
  const header=['Data/hora (Brasília)','Placa','Modelo','Evento','Motorista','Km retirada','Km devolução','Km percorridos','Litros','Valor (R$)','Pagamento','Descrição'];
  const data=rows.map(r=>[timeLabel(r),r.plate,r.model,r.type,r.driver,r.kmStart,r.kmEnd,r.distance,r.liters,r.amount,r.payment,r.description]);
  return '\ufeff'+[header,...data].map(line=>line.map(csvCell).join(';')).join('\r\n');
 }
 root.FleetReports={rows,filter,summary,csv,timeLabel,category,fineTime,dayOf};
})(globalThis);
