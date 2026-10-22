let vehicleFilter={query:'',status:'all',driver:''};
let alertFilter={category:'all',severity:'all'};
function resetFleetTools(){driverCnhEdit=null;vehicleFilter={query:'',status:'all',driver:''};alertFilter={category:'all',severity:'all'};}
function vehicleFilterMarkup() {
 const drivers=[...new Set(S.cars.map(c=>c.uso?.mot).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 return `<div class="panel fleet-toolbar"><label class="fleet-search">Buscar veículo<input id="vehicle-search" type="search" placeholder="Placa, modelo ou motorista" value="${esc(vehicleFilter.query)}" autocomplete="off"></label><label>Situação do veículo<select id="vehicle-status"><option value="all">Todos os veículos</option><option value="available">Disponíveis</option><option value="inuse">Em uso</option><option value="attention">Com vencimentos</option></select></label><label>Motorista em uso<select id="vehicle-driver"><option value="">Todos os motoristas</option>${drivers.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label><button type="button" class="btn sec" id="clear-vehicle-filters">Limpar filtros</button><p id="vehicle-result-count" role="status" aria-live="polite"></p></div>`;
}
function applyVehicleFilters() {
 const container=document.querySelector('#car');if(!container.querySelector('#vehicle-search'))return;
 if(![...document.querySelector('#vehicle-driver').options].some(o=>o.value===vehicleFilter.driver))vehicleFilter.driver='';
 document.querySelector('#vehicle-status').value=vehicleFilter.status;
 document.querySelector('#vehicle-driver').value=vehicleFilter.driver;
 let count=0;
 container.querySelectorAll('.car[data-car-id]').forEach(card=>{
  const car=S.cars.find(c=>String(c.id)===card.dataset.carId);
  card.hidden=!car||!FleetInsights.matches(car,vehicleFilter);if(!card.hidden)count++;
 });
 document.querySelector('#vehicle-result-count').textContent=`${count} de ${S.cars.length} veículo${S.cars.length===1?'':'s'}`;
 let empty=container.querySelector('#vehicle-empty');
 if(!empty){empty=document.createElement('p');empty.id='vehicle-empty';empty.className='empty';container.append(empty);}
 empty.hidden=count>0;empty.textContent=S.cars.length?'Nenhum veículo corresponde aos filtros. Tente limpar a busca.':'Sua frota ainda está vazia. Cadastre o primeiro veículo para começar.';
}
function renderAlertCenter() {
 const section=document.querySelector('#alerts');if(!section)return;
 const driver=cloud.context?.role==='driver';
 const alerts=driver?[]:FleetInsights.collect(S);
 if(!section.querySelector('#alert-list'))section.innerHTML=`<div class="alert-summary" id="alert-summary"></div><div class="panel fleet-toolbar"><label>Categoria<select id="alert-category"><option value="all">Todas as categorias</option><option value="documents">Documentos dos veículos</option><option value="maintenance">Revisões e peças</option><option value="drivers">CNH dos motoristas</option></select></label><label>Prioridade<select id="alert-severity"><option value="all">Todas as prioridades</option><option value="urgent">Vencidos ou vencendo hoje</option><option value="upcoming">Próximos vencimentos</option></select></label><button class="btn sec" type="button" id="clear-alert-filters">Limpar filtros</button></div><p class="settings-help">Documentos: próximos 30 dias. Revisão: próximos 500 km. Peças: próximos 1.000 km. Datas no horário de Brasília.</p><p id="alert-result-count" role="status" aria-live="polite"></p><div id="alert-list" class="alert-list"></div>`;
 const urgent=alerts.filter(a=>a.severity==='urgent').length;
 document.querySelector('#alert-summary').innerHTML=`<div class="panel"><b>${alerts.length}</b><span>Pendências no total</span></div><div class="panel urgent"><b>${urgent}</b><span>Vencidas ou vencendo hoje</span></div><div class="panel"><b>${alerts.length-urgent}</b><span>Próximos vencimentos</span></div>`;
 document.querySelector('#alert-category').value=alertFilter.category;document.querySelector('#alert-severity').value=alertFilter.severity;
 const visible=alerts.filter(a=>(alertFilter.category==='all'||a.category===alertFilter.category)&&(alertFilter.severity==='all'||a.severity===alertFilter.severity));
 document.querySelector('#alert-result-count').textContent=`${visible.length} de ${alerts.length} alerta${alerts.length===1?'':'s'}`;
 document.querySelector('#alert-list').innerHTML=visible.map(a=>`<article class="panel alert-item ${a.severity}"><span class="alert-symbol" aria-hidden="true">${ic('alert')}</span><div><span class="alert-priority">${a.severity==='urgent'?'Atenção imediata':'Planeje com antecedência'}</span><h3>${esc(a.subject)}</h3><p>${esc(a.title)}</p></div><button type="button" class="btn sec" data-alert-target="${a.target}" ${a.carId!==undefined?`data-alert-car="${a.carId}"`:''}>${a.target==='car'?'Ver veículo':'Ver motoristas'}</button></article>`).join('')||`<div class="panel empty">${alerts.length?'Nenhum alerta corresponde aos filtros.':'Tudo em dia: nenhum vencimento próximo nos dados cadastrados.'}</div>`;
 const link=document.querySelector('.tab[data-t="alerts"]');
 if(link){let badge=link.querySelector('.nav-count');if(!badge){badge=document.createElement('span');badge.className='nav-count';link.append(badge);}badge.textContent=alerts.length;badge.hidden=!alerts.length;}
 const shortcut=document.querySelector('#alerts-shortcut');if(shortcut){shortcut.setAttribute('aria-label',`Central de alertas: ${alerts.length} pendências`);shortcut.querySelector('.alert-count').textContent=alerts.length||'';}
}
document.addEventListener('input',event=>{
 if(event.target.id==='vehicle-search'){vehicleFilter.query=event.target.value;applyVehicleFilters();}
});
document.addEventListener('change',event=>{
 if(event.target.id==='vehicle-status'){vehicleFilter.status=event.target.value;applyVehicleFilters();}
 if(event.target.id==='vehicle-driver'){vehicleFilter.driver=event.target.value;applyVehicleFilters();}
 if(event.target.id==='alert-category'){alertFilter.category=event.target.value;renderAlertCenter();}
 if(event.target.id==='alert-severity'){alertFilter.severity=event.target.value;renderAlertCenter();}
});
document.addEventListener('click',event=>{
 if(event.target.closest('#clear-vehicle-filters')){vehicleFilter={query:'',status:'all',driver:''};document.querySelector('#vehicle-search').value='';applyVehicleFilters();}
 if(event.target.closest('#clear-alert-filters')){alertFilter={category:'all',severity:'all'};renderAlertCenter();}
 const target=event.target.closest('[data-alert-target]');
 if(target&&cloud.context?.role!=='driver') {
  if(target.dataset.alertTarget==='car') {
   const car=S.cars.find(c=>String(c.id)===target.dataset.alertCar);if(!car)return;
   vehicleFilter={query:car.placa,status:'all',driver:''};cars();navigateLayout('car');
  }else navigateLayout('drv');
 }
});
function updateCurrentAlerts(){if(typeof cloud!=='undefined'&&cloud.csrf){renderAlertCenter();applyVehicleFilters();}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateCurrentAlerts();});
setInterval(updateCurrentAlerts,60000);
