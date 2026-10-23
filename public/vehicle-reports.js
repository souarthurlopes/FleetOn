let selectedVehicleId=null,vehicleDetailTab='overview',reportPage=1;
const REPORT_PAGE_SIZE=50;
function defaultReportFilter(){const day=FleetInsights.today();return {from:day.slice(0,7)+'-01',to:day,vehicle:'',driver:'',kind:'all'};}
let reportFilter;
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
function canManageReports(){return cloud.context?.role==='manager';}
function resetVehicleReports(){selectedVehicleId=null;vehicleDetailTab='overview';reportFilter=defaultReportFilter();reportPage=1;}
function reportTable(rows){return `<div class="scroll"><table class="report-table"><thead><tr><th>Data (Brasília)</th><th>Veículo</th><th>Evento</th><th>Motorista</th><th>Km percorridos</th><th>Litros</th><th>Valor</th><th>Detalhe</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(FleetReports.timeLabel(r))}</td><td>${esc(r.plate||'Sem placa')}<small>${esc(r.model)}</small></td><td>${esc(r.type)}${r.payment?`<small>${r.payment}</small>`:''}</td><td>${esc(r.driver)}</td><td>${r.distance===null?'—':fmt(r.distance)}</td><td>${r.liters===null?'—':fmt(r.liters)}</td><td>${r.amount===null?'—':money(r.amount)}</td><td>${esc(r.description)}${r.dueDate?`<small class="${FleetInsights.fineDue(r.entry).urgent?'alerta':''}">Vencimento: ${r.dueDate.split('-').reverse().join('/')} · ${FleetInsights.fineDue(r.entry).label}</small>`:''}${r.kmStart!==null?`<small>Retirada: ${fmt(r.kmStart)} km</small>`:''}${r.kmEnd!==null?`<small>Devolução: ${fmt(r.kmEnd)} km</small>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhum registro encontrado para esta seleção.</td></tr>'}</tbody></table></div>`;}
function reportOptions(rows){
 const vehicles=[...new Set([...S.cars.map(c=>c.placa),...rows.map(r=>r.plate)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const drivers=new Map();for(const row of rows)if(row.driverKey)drivers.set(row.driverKey,row.driver);
 const nameCounts=new Map();for(const name of drivers.values())nameCounts.set(name,(nameCounts.get(name)||0)+1);
 return {vehicles,drivers:[...drivers].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR')).map(([key,name])=>({key,label:name+(nameCounts.get(name)>1?(key.startsWith('u:')?' · conta '+key.slice(-4):' · registro antigo'):'')}))};
}
function syncSelectOptions(select,options,value){const focused=document.activeElement===select;if(focused)return;select.replaceChildren();for(const [key,label] of options){const option=document.createElement('option');option.value=key;option.textContent=label;select.append(option);}if(value&&!options.some(([key])=>key===value)){const option=document.createElement('option');option.value=value;option.textContent='Filtro indisponível: '+value;select.append(option);}select.value=value;}
function renderReports(){
 const section=document.querySelector('#reports');if(!section)return;if(!canManageReports()){section.replaceChildren();return;}
 if(!reportFilter)reportFilter=defaultReportFilter();
 if(!section.querySelector('#report-results'))section.innerHTML=`<div class="panel report-controls"><div class="report-presets"><button type="button" class="btn sec" data-report-period="month">Este mês</button><button type="button" class="btn sec" data-report-period="30">Últimos 30 dias</button><button type="button" class="btn sec" data-report-period="all">Todo período</button></div><div class="report-filters"><label>Data inicial<input id="report-from" type="date"></label><label>Data final<input id="report-to" type="date"></label><label>Veículo<select id="report-vehicle"></select></label><label>Motorista<select id="report-driver"></select></label><label>Tipo de registro<select id="report-kind"><option value="all">Todos os registros</option><option value="trips">Viagens</option><option value="fuel">Abastecimentos</option><option value="maintenance">Manutenção</option><option value="fines">Multas</option><option value="other">Outros</option></select></label></div><p id="report-error" role="alert"></p><div class="report-actions"><button type="button" class="btn" id="export-report">${ic('file')}Exportar CSV / Excel</button><button type="button" class="btn sec" id="print-report">Imprimir / PDF</button><button type="button" class="btn sec" id="clear-report-filters">Limpar filtros</button></div></div><div class="report-kpis" id="report-kpis"></div><p class="settings-help">Datas no horário de Brasília. Gastos incluem multas pagas e pendentes. Km são somados nas devoluções. Gastos sem vínculo com uma viagem não são atribuídos a um motorista.</p><p id="report-count" role="status" aria-live="polite"></p><div class="panel report-screen" id="report-results"></div><div class="report-pagination"><button type="button" class="btn sec" id="report-previous">Anterior</button><span id="report-page-label"></span><button type="button" class="btn sec" id="report-next">Próxima</button></div><div class="report-print" id="report-print"></div>`;
 const all=FleetReports.rows(S),options=reportOptions(all);
 syncSelectOptions(document.querySelector('#report-vehicle'),[['','Todos os veículos'],...options.vehicles.map(p=>[p,p])],reportFilter.vehicle);
 syncSelectOptions(document.querySelector('#report-driver'),[['','Todos os motoristas'],['unknown','Não identificado'],...options.drivers.map(d=>[d.key,d.label])],reportFilter.driver);
 for(const [key,id] of [['from','report-from'],['to','report-to'],['kind','report-kind']])if(document.activeElement?.id!==id)document.querySelector('#'+id).value=reportFilter[key];
 renderReportResults(all);
}
function reportError(){
 if(document.querySelector('#report-from')?.validity.badInput||document.querySelector('#report-to')?.validity.badInput)return 'Informe datas válidas.';
 if(reportFilter.from&&FleetInsights.civilDay(reportFilter.from)===null||reportFilter.to&&FleetInsights.civilDay(reportFilter.to)===null)return 'Informe datas válidas.';
 if(reportFilter.from&&reportFilter.to&&reportFilter.from>reportFilter.to)return 'A data inicial não pode ser posterior à data final.';return '';
}
function selectedReportRows(){return FleetReports.filter(FleetReports.rows(S),reportFilter);}
function renderReportResults(all=FleetReports.rows(S)){
 if(!canManageReports())return;const error=reportError();document.querySelector('#report-error').textContent=error;
 document.querySelector('#export-report').disabled=!!error;document.querySelector('#print-report').disabled=!!error;
 const rows=error?[]:FleetReports.filter(all,reportFilter),summary=FleetReports.summary(rows);
 document.querySelector('#report-kpis').innerHTML=`<div class="panel"><b>${money(summary.amount)}</b><span>Gastos registrados</span></div><div class="panel"><b>${fmt(summary.distance)} km</b><span>Percorridos nas viagens</span></div><div class="panel"><b>${summary.trips}</b><span>Viagens concluídas</span></div><div class="panel"><b>${fmt(summary.liters)} L</b><span>Combustível registrado</span></div>`;
 const missing=all.filter(r=>!r.day).length;document.querySelector('#report-count').textContent=`${rows.length} registro${rows.length===1?'':'s'} encontrado${rows.length===1?'':'s'}.${missing?' Há '+missing+' registro(s) sem data válida; use Todo período para incluí-los.':''}`;
 const pages=Math.max(1,Math.ceil(rows.length/REPORT_PAGE_SIZE));reportPage=Math.min(Math.max(1,reportPage),pages);
 document.querySelector('#report-results').innerHTML=reportTable(rows.slice((reportPage-1)*REPORT_PAGE_SIZE,reportPage*REPORT_PAGE_SIZE));
 document.querySelector('#report-page-label').textContent=`Página ${reportPage} de ${pages}`;document.querySelector('#report-previous').disabled=reportPage<=1;document.querySelector('#report-next').disabled=reportPage>=pages;
}
function reportCaption(){
 const vehicle=reportFilter.vehicle||'Todos os veículos',driver=document.querySelector('#report-driver')?.selectedOptions[0]?.textContent||'Todos os motoristas';
 return `${reportFilter.from||'Início dos registros'} a ${reportFilter.to||'Fim dos registros'} · ${vehicle} · ${driver} · ${document.querySelector('#report-kind').selectedOptions[0].textContent}`;
}
function prepareReportPrint(){if(currentPage!=='reports'||!canManageReports()||reportError())return;
 document.querySelector('#report-print').innerHTML=`${companyPrintHeading()}<h1>FleetOn · Relatório da frota</h1><p>${esc(reportCaption())}</p><p>Gerado em ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · Horário de Brasília</p>${reportTable(selectedReportRows())}`;
}
const detailTabs={overview:'Visão geral',trips:'Viagens',photos:'Fotos',maintenance:'Manutenção',documents:'Documentos',costs:'Custos'};
function renderVehicleDetail(){
 const section=document.querySelector('#detail');if(!section)return;if(!canManageReports()){section.replaceChildren();return;}
 const car=S.cars.find(c=>String(c.id)===String(selectedVehicleId));
 if(!car){section.innerHTML='<div class="panel empty">Selecione um veículo em Veículos para ver os detalhes.</div>';return;}
 const rows=FleetReports.rows(S).filter(r=>r.plate===car.placa),summary=FleetReports.summary(rows),alerts=FleetInsights.vehicleAlerts(car);
 section.innerHTML=`<div class="vehicle-heading panel"><div><span class="settings-help">VEÍCULO</span><h2>${esc(car.placa)}</h2><p>${esc(car.modelo)} · ${fmt(car.km)} km</p></div><span class="badge ${car.uso?'emuso':'livre'}">${car.uso?'Em uso':'Disponível'}</span><div class="report-actions"><button type="button" class="btn sec" data-detail-back>Voltar a veículos</button><button type="button" class="btn" data-detail-report>Ver nos relatórios</button></div></div>${S.cars.filter(c=>c.placa===car.placa).length>1?'<p class="note">Há mais de um cadastro com esta placa. O histórico é vinculado pela placa e pode incluir os outros cadastros.</p>':''}<div class="detail-tabs" role="tablist" aria-label="Informações do veículo">${Object.entries(detailTabs).map(([key,label])=>`<button type="button" class="detail-tab" role="tab" id="detail-tab-${key}" aria-controls="detail-content" aria-selected="${vehicleDetailTab===key}" tabindex="${vehicleDetailTab===key?'0':'-1'}" data-detail-tab="${key}">${label}</button>`).join('')}</div><div id="detail-content" role="tabpanel" aria-labelledby="detail-tab-${vehicleDetailTab}"></div>`;
 const content=document.querySelector('#detail-content');
 if(vehicleDetailTab==='overview')content.innerHTML=`<div class="report-kpis"><div class="panel"><b>${fmt(car.km)} km</b><span>Hodômetro atual</span></div><div class="panel"><b>${summary.trips}</b><span>Viagens concluídas</span></div><div class="panel"><b>${money(summary.amount)}</b><span>Gastos registrados</span></div><div class="panel"><b>${alerts.length}</b><span>Pendências de vencimento</span></div></div><div class="detail-grid"><section class="panel"><h3>Quem está com o veículo?</h3>${car.uso?`<p><b>${esc(car.uso.mot)}</b></p><p>Destino: ${esc(car.uso.dest)}</p><p>Retirado em ${esc(car.uso.quando)}</p><p>Km na retirada: ${fmt(car.uso.kmIni)}</p>`:'<p class="livre">Veículo disponível para retirada.</p>'}</section><section class="panel"><h3>Próxima revisão</h3><p>${typeof car.prox==='number'&&car.prox>0?fmt(car.prox)+' km':'Km não programado'}</p><p>${validDateLabel(car.revdata)}</p><button type="button" class="btn sec" data-detail-edit="review">Ajustar revisão</button></section><section class="panel"><h3>Pendências</h3>${alerts.map(a=>`<p class="alerta">${esc(a.title)}</p>`).join('')||'<p>Nenhum vencimento próximo nos dados cadastrados.</p>'}</section></div>`;
 if(vehicleDetailTab==='trips')content.innerHTML=`<div class="panel"><h3>Retiradas e devoluções</h3>${reportTable(rows.filter(r=>r.kind==='trips'))}</div>`;
 if(vehicleDetailTab==='maintenance')content.innerHTML=`<div class="panel"><h3>Manutenções registradas</h3><button type="button" class="btn sec" data-detail-edit="maintenance">Registrar manutenção</button>${reportTable(rows.filter(r=>r.kind==='maintenance'))}</div><div class="panel"><h3>Peças e vida útil</h3>${(car.pecas||[]).map((p,i)=>p?`<p>${esc(PN[i]||'Peça')}: última troca ${p.troca===null||p.troca===undefined?'não informada':fmt(p.troca)+' km'} · vida útil ${fmt(p.vida)} km</p>`:'').join('')||'<p>Sem peças cadastradas.</p>'}<button type="button" class="btn sec" data-detail-edit="parts">Editar peças</button></div>`;
 if(vehicleDetailTab==='documents')content.innerHTML=`<div class="detail-grid">${[['IPVA',car.ipva],['Licenciamento',car.lic],['Seguro',car.seg],['Revisão por data',car.revdata]].map(([name,date])=>`<section class="panel"><h3>${name}</h3><p>${validDateLabel(date)}</p><p class="${FleetInsights.dateAlert(name,date)?'alerta':'settings-help'}">${date&&FleetInsights.civilDay(date)!==null?esc(FleetInsights.dateAlert(name,date)?.title||'Em dia'):'Informe uma data de vencimento.'}</p></section>`).join('')}</div><div class="report-actions"><button type="button" class="btn" data-detail-edit="documents">Editar documentos</button><button type="button" class="btn sec" data-detail-edit="review">Editar revisão</button></div>`;
 if(vehicleDetailTab==='costs')content.innerHTML=`<div class="report-kpis">${[['fuel','Combustível'],['maintenance','Manutenção'],['fines','Multas'],['other','Outros registros']].map(([key,label])=>`<div class="panel"><b>${money(FleetReports.summary(rows.filter(r=>r.kind===key||(key==='other'&&r.kind==='trips'))).amount)}</b><span>${label}</span></div>`).join('')}</div><div class="panel"><h3>Total registrado: ${money(summary.amount)}</h3><p class="settings-help">Inclui multas pagas e pendentes. Use os relatórios para filtrar por período ou motorista.</p>${reportTable(rows.filter(r=>r.amount!==null))}</div>`;
 if(vehicleDetailTab==='photos'){
  const photos=rows.filter(r=>r.source==='log'&&(FleetInspection.photo(r.entry.foto,262144)||FleetInspection.validate(r.entry.inspection)&&Object.keys(r.entry.inspection.photos).length));
  content.innerHTML=photos.map(r=>`<section class="panel detail-photo-event"><div class="row"><h3>${esc(r.type)} · ${esc(FleetReports.timeLabel(r))}</h3>${r.type==='Devolução'?`<button class="btn sec" type="button" data-detail-compare="${r.index}">Comparar etapas</button>`:''}</div><p>${esc(r.driver)}</p><div class="inspection-gallery">${inspectionGallery(r.entry.inspection,r.entry.foto,r.type)}</div></section>`).join('')||'<div class="panel empty">Nenhuma foto registrada para este veículo.</div>';
 }
}
function validDateLabel(value){return !value?'Não cadastrado':FleetInsights.civilDay(value)===null?'Data inválida':value.split('-').reverse().join('/');}
function openVehicleDetail(id){if(!canManageReports())return;selectedVehicleId=id;vehicleDetailTab='overview';renderVehicleDetail();navigateLayout('detail');}
function readReportFilter(){reportFilter={from:document.querySelector('#report-from').value,to:document.querySelector('#report-to').value,vehicle:document.querySelector('#report-vehicle').value,driver:document.querySelector('#report-driver').value,kind:document.querySelector('#report-kind').value};reportPage=1;renderReportResults();}
document.addEventListener('change',e=>{if(e.target.closest('#reports .report-controls')&&canManageReports())readReportFilter();});
document.addEventListener('click',e=>{
 const target=e.target.closest('button');if(!target||!canManageReports())return;
 if(target.hasAttribute('data-open-vehicle'))openVehicleDetail(target.dataset.openVehicle);
 if(target.hasAttribute('data-detail-back'))navigateLayout('car');
 if(target.hasAttribute('data-detail-tab')){vehicleDetailTab=target.dataset.detailTab;renderVehicleDetail();document.querySelector('#detail-tab-'+vehicleDetailTab).focus();}
 if(target.hasAttribute('data-detail-compare')){cmp=Number(target.dataset.detailCompare);hist();navigateLayout('hist');}
 if(target.hasAttribute('data-detail-report')){const car=S.cars.find(c=>String(c.id)===String(selectedVehicleId));if(car){reportFilter={from:'',to:'',vehicle:car.placa,driver:'',kind:'all'};reportPage=1;renderReports();navigateLayout('reports');}}
 if(target.hasAttribute('data-detail-edit')){
  const car=S.cars.find(c=>String(c.id)===String(selectedVehicleId));if(!car)return;
  if(target.dataset.detailEdit==='maintenance'){navigateLayout('log');document.querySelector('#lc').value=car.id;document.querySelector('#lt').value='Revisão';document.querySelector('#lk').value=car.km;}
  else {vehicleFilter={query:car.placa,status:'all',driver:''};docOpen=target.dataset.detailEdit==='documents'?car.id:null;rvOpen=target.dataset.detailEdit==='review'?car.id:null;pcOpen=target.dataset.detailEdit==='parts'?car.id:null;open=null;cars();navigateLayout('car');}
 }
 if(target.dataset.reportPeriod){reportFilter={...reportFilter,from:defaultReportFilter().from,to:defaultReportFilter().to};if(target.dataset.reportPeriod==='all'){reportFilter.from=reportFilter.to='';}if(target.dataset.reportPeriod==='30')reportFilter.from=new Date((FleetInsights.civilDay(reportFilter.to)-29)*86400000).toISOString().slice(0,10);reportPage=1;renderReports();}
 if(target.id==='clear-report-filters'){reportFilter={from:'',to:'',vehicle:'',driver:'',kind:'all'};reportPage=1;renderReports();}
 if(target.id==='report-previous'){reportPage--;renderReportResults();}if(target.id==='report-next'){reportPage++;renderReportResults();}
 if(target.id==='export-report'&&!reportError()){
  const url=URL.createObjectURL(new Blob([FleetReports.csv(selectedReportRows(),companyState)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='fleeton-relatorio-'+FleetInsights.today()+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 if(target.id==='print-report'&&!reportError()){prepareReportPrint();window.print();}
});
document.addEventListener('keydown',e=>{
 const tab=e.target.closest('[data-detail-tab]');if(!tab||!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;
 const keys=Object.keys(detailTabs),index=keys.indexOf(vehicleDetailTab);e.preventDefault();vehicleDetailTab=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(index+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length];renderVehicleDetail();document.querySelector('#detail-tab-'+vehicleDetailTab).focus();
});
window.addEventListener('beforeprint',prepareReportPrint);
window.addEventListener('afterprint',()=>document.querySelector('#report-print')?.replaceChildren());
