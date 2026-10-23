/* Regras compartilhadas entre os cartões, filtros e central de alertas. */
(function(root) {
 const DAY=86400000;
 function civilDay(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.getTime()/DAY:null;
 }
 function today(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=type=>parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
 }
 function daysUntil(date,now=new Date()) {
  const day=civilDay(date);return day===null?null:day-civilDay(today(now));
 }
 function dateAlert(label,date,now) {
  const days=daysUntil(date,now);if(days===null||days>30)return null;
  const title=days<0?`${label}: ${-days} dia${days===-1?'':'s'} em atraso`:days===0?`${label} vence hoje`:`${label} vence em ${days} dia${days===1?'':'s'}`;
  return {title,days,date,severity:days<=0?'urgent':'upcoming'};
 }
 function fineDue(fine,now=new Date()) {
  const valid=civilDay(fine.vencimento)!==null;
  const days=valid?daysUntil(fine.vencimento,now):null;
  return {date:valid?fine.vencimento:'',label:!valid?'Não informado':fine.pago?'Paga':days<0?'Vencida':days===0?'Vence hoje':'A vencer',urgent:valid&&!fine.pago&&days<=0};
 }
 function kmAlert(label,due,current,threshold=500) {
  if(typeof due!=='number'||!Number.isFinite(due)||due<=0||typeof current!=='number'||!Number.isFinite(current))return null;
  const remaining=due-current;if(remaining>threshold)return null;
  return {title:remaining<0?`${label}: ${(-remaining).toLocaleString('pt-BR')} km em atraso`:remaining===0?`${label}: quilometragem limite atingida`:`${label} em ${remaining.toLocaleString('pt-BR')} km`,remaining,severity:remaining<=0?'urgent':'upcoming'};
 }
 function vehicleAlerts(car,now=new Date()) {
  const result=[];
  for(const [key,label,category] of [['ipva','IPVA','documents'],['lic','Licenciamento','documents'],['seg','Seguro','documents'],['revdata','Revisão por data','maintenance']]) {
   const alert=dateAlert(label,car[key],now);if(alert)result.push({...alert,id:`car-${car.id}-${key}`,category,carId:car.id,subject:car.placa,target:'car'});
  }
  const review=kmAlert('Revisão',car.prox,car.km);if(review)result.push({...review,id:`car-${car.id}-km`,category:'maintenance',carId:car.id,subject:car.placa,target:'car'});
  (Array.isArray(car.pecas)?car.pecas:[]).forEach((part,i)=>{
   if(!part||typeof part.troca!=='number'||typeof part.vida!=='number'||part.vida<=0)return;
   const alert=kmAlert(['Pneus','Bateria','Pastilhas'][i]||'Peça',part.troca+part.vida,car.km,1000);
   if(alert)result.push({...alert,id:`car-${car.id}-part-${i}`,category:'maintenance',carId:car.id,subject:car.placa,target:'car'});
  });
  return result;
 }
 function collect(state,now=new Date()) {
  const result=(state.cars||[]).flatMap(car=>vehicleAlerts(car,now));
  for(const driver of state.drivers||[]) {
   const alert=dateAlert('CNH',driver.cnh,now);
   if(alert)result.push({...alert,id:`driver-${driver.id}-cnh`,category:'drivers',driverId:driver.id,subject:driver.nome,target:'drv'});
  }
  return result.sort((a,b)=>(a.severity==='urgent'?0:1)-(b.severity==='urgent'?0:1)||(a.days??Infinity)-(b.days??Infinity)||(a.remaining??Infinity)-(b.remaining??Infinity)||String(a.subject).localeCompare(String(b.subject),'pt-BR'));
 }
 const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 function matches(car,filter,now=new Date()) {
  if(filter.query&&!normalize(`${car.placa} ${car.modelo} ${car.uso?.mot||''}`).includes(normalize(filter.query)))return false;
  if(filter.driver&&car.uso?.mot!==filter.driver)return false;
  if(filter.status==='available'&&car.uso)return false;
  if(filter.status==='inuse'&&!car.uso)return false;
  if(filter.status==='attention'&&!vehicleAlerts(car,now).length)return false;
  return true;
 }
 root.FleetInsights={civilDay,today,daysUntil,dateAlert,fineDue,kmAlert,vehicleAlerts,collect,normalize,matches};
})(globalThis);
