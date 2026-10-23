const inspectionDrafts=new WeakMap();
function inspectionMarkup(car){
 const returning=!!car.uso;
 const prior=car.uso?.inspection_summary;
 return `<fieldset class="inspection-panel"><legend>${returning?'Checklist de devolução':'Checklist de retirada'}</legend><p class="settings-help">Registre o que foi conferido. Fotos são opcionais; itens não verificados ficam identificados no histórico.</p>
 ${returning&&prior?`<div class="inspection-baseline"><b>Na retirada</b><p>Combustível: ${esc(prior.fuel)} · ${esc(prior.notes||'Sem observações')}</p></div>`:''}
 <div class="inspection-fields"><label>Combustível<select id="comb"><option value="">Selecione o nível</option>${FleetInspection.fuels.map(f=>`<option>${f}</option>`).join('')}</select></label>${Object.entries(FleetInspection.items).map(([key,label])=>`<label>${label}<select data-inspection-item="${key}">${Object.entries(FleetInspection.statuses).map(([value,text])=>`<option value="${value}" ${value==='not_checked'?'selected':''}>${text}</option>`).join('')}</select></label>`).join('')}</div>
 <label>Observações e avarias<textarea id="av" maxlength="1000" rows="3" placeholder="Descreva a avaria e onde ela está. Obrigatório se houver item com avaria."></textarea></label>
 <div class="inspection-photos">${Object.entries(FleetInspection.sides).map(([key,label])=>`<div class="inspection-photo"><label>${label}<input type="file" accept="image/*" capture="environment" data-inspection-photo="${key}"></label><div data-inspection-preview="${key}" class="inspection-preview"></div><button type="button" class="btn sec sm" data-remove-inspection-photo="${key}">Remover foto</button><p data-inspection-status="${key}" role="status"></p></div>`).join('')}</div>
 <p class="settings-help">Até 4 fotos, com até 10 MB no arquivo original. Cada foto é reduzida antes de salvar.</p><label class="inspection-confirm"><input type="checkbox" id="inspection-confirm">Confirmo as informações acima e identifiquei os itens não conferidos.</label><p class="inspection-error" role="alert"></p></fieldset>`;
}
const touchedInspections=new WeakSet();
function hasInspectionDraft(){const panel=document.querySelector('.inspection-panel');return !!panel&&touchedInspections.has(panel);}
function clearInspectionError(panel){const error=panel.querySelector('.inspection-error'),message=error.textContent;error.textContent='';if(message&&syncStatus.textContent===message)syncStatus.textContent='Checklist em edição.';}
document.addEventListener('input',event=>{const panel=event.target.closest('.inspection-panel');if(panel){touchedInspections.add(panel);clearInspectionError(panel);}});
function inspectionDraft(panel){let draft=inspectionDrafts.get(panel);if(!draft){draft={photos:{},tokens:{},pending:new Set(),errors:{}};inspectionDrafts.set(panel,draft);}return draft;}
async function compactInspectionPhoto(file){
 if(!file?.type.startsWith('image/')||file.size>10*1024*1024)throw new Error('Escolha uma imagem de até 10 MB.');
 let image;try{image=await createImageBitmap(file);}catch{throw new Error('Não foi possível abrir essa imagem. Escolha outra foto.');}
 try{
  if(!image.width||!image.height)throw new Error('Imagem inválida.');
  const canvas=document.createElement('canvas');
  for(const edge of [720,540,360]){
   const scale=Math.min(1,edge/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.7,.5,.35]){const data=canvas.toDataURL('image/jpeg',quality);if(FleetInspection.photo(data))return data;}
  }throw new Error('Não foi possível compactar a foto. Escolha outra imagem.');
 }finally{image.close();}
}
async function readInspection(){
 const panel=document.querySelector('.inspection-panel');if(!panel)throw new Error('Abra o checklist do veículo.');
 const draft=inspectionDraft(panel),error=panel.querySelector('.inspection-error');
 error.textContent='';
 try{
  if(draft.pending.size)throw new Error('Aguarde a preparação das fotos antes de confirmar.');
  if(Object.keys(draft.errors).length)throw new Error('Substitua ou remova a foto que apresentou erro.');
  const value={version:1,fuel:panel.querySelector('#comb').value,items:Object.fromEntries([...panel.querySelectorAll('[data-inspection-item]')].map(el=>[el.dataset.inspectionItem,el.value])),notes:panel.querySelector('#av').value.trim(),photos:{...draft.photos},confirmed:panel.querySelector('#inspection-confirm').checked};
  if(!value.fuel)throw new Error('Selecione o nível de combustível.');
  if(Object.values(value.items).includes('damage')&&!value.notes)throw new Error('Descreva a avaria nas observações.');
  if(!value.confirmed)throw new Error('Confirme as informações do checklist antes de continuar.');
  if(!FleetInspection.validate(value))throw new Error('Confira os campos do checklist.');
  return value;
 }catch(reason){error.textContent=reason.message;throw reason;}
}
function inspectionThumbnail(value){return Object.values(value.photos)[0]||'';}
function inspectionCondition(value){return value.fuel+', '+(value.notes||'Sem observações');}
function inspectionGallery(value,legacy,stage){
 const photos=FleetInspection.validate(value)?value.photos:{};
 const entries=Object.entries(photos);
 if(!entries.length&&FleetInspection.photo(legacy,262144))entries.push(['legacy',legacy]);
 return entries.map(([side,data])=>`<figure><button type="button" class="inspection-zoom" data-inspection-image="${esc(data)}" aria-label="Ampliar foto: ${esc(FleetInspection.sides[side]||stage)}"><img src="${esc(data)}" alt="${esc(FleetInspection.sides[side]||stage)}" loading="lazy"></button><figcaption>${esc(FleetInspection.sides[side]||'Foto do registro anterior')}</figcaption></figure>`).join('')||'<p class="empty">Nenhuma foto registrada nesta etapa.</p>';
}
function inspectionComparison(){
 if(cmp==null||!S.log[cmp])return '';const end=S.log[cmp],start=FleetInspection.pair(S.log,cmp);
 const changes=FleetInspection.compare(start?.inspection,end.inspection);
 const stage=(title,record)=>`<section class="inspection-stage"><h3>${title}</h3><p class="settings-help">${esc(record?.quando||'Registro não encontrado')}</p>${typeof record?.km==='number'?`<p><b>Hodômetro: ${fmt(record.km)} km</b></p>`:''}${record?`<p>${esc(record.det)}</p>`:''}${FleetInspection.validate(record?.inspection)?`<div class="inspection-baseline">Combustível: <b>${esc(record.inspection.fuel)}</b><p>${esc(record.inspection.notes||'Sem observações')}</p></div>`:''}<div class="inspection-gallery">${inspectionGallery(record?.inspection,record?.foto,title)}</div></section>`;
 return `<div class="panel inspection-comparison"><div class="row"><h2>${esc(end.placa)} · Retirada e devolução</h2><button class="btn sec sm" data-go="cancel:0">Fechar</button></div>${changes?`<div class="scroll"><table><thead><tr><th>Item</th><th>Retirada</th><th>Devolução</th></tr></thead><tbody>${changes.map(row=>`<tr class="${row.changed?'inspection-changed':''}"><td>${esc(row.label)}${row.changed?' · Alterado':''}</td><td>${esc(FleetInspection.statuses[row.before])}</td><td>${esc(FleetInspection.statuses[row.after])}</td></tr>`).join('')}<tr class="${start.inspection.fuel!==end.inspection.fuel?'inspection-changed':''}"><td>Combustível</td><td>${esc(start.inspection.fuel)}</td><td>${esc(end.inspection.fuel)}</td></tr></tbody></table></div><p class="settings-help">Destaques indicam diferenças entre os registros. A avaliação das fotos e das causas deve ser feita pelo gestor.</p>`:'<p class="settings-help">Registro anterior ao checklist: fotos e observações disponíveis continuam abaixo.</p>'}${typeof end.rodou==='number'?`<p class="inspection-distance">Distância percorrida: <b>${fmt(end.rodou)} km</b></p>`:''}<div class="inspection-stages">${stage('Retirada',start)}${stage('Devolução',end)}</div></div>`;
}
async function managerTrip(action,car){
 try{
  let driver,destination,km;
  if(action==='out'){
   driver=S.drivers.find(d=>d.id==document.querySelector('#mot').value);destination=document.querySelector('#dest').value.trim();
   if(!driver)throw new Error('Cadastre um motorista antes de retirar um veículo.');
   if(driver.cnh&&dias(driver.cnh)<0)throw new Error('CNH vencida. Atualize a validade antes da retirada.');
   if(!destination)throw new Error('Informe o destino.');
   km=FleetInspection.returnKm(document.querySelector('#kmi').value,car.km);if(km===null)throw new Error('Informe o km da retirada, igual ou maior que o último registrado.');
  }else {const raw=document.querySelector('#kmf').value;km=FleetInspection.returnKm(raw,car.km);if(km===null)throw new Error('Informe uma quilometragem final igual ou maior que a atual.');}
  const inspection=await readInspection();
  const timestamp=Date.now(),when=hoje(),photo=inspectionThumbnail(inspection),condition=inspectionCondition(inspection);
  if(action==='out'){
   const tripId=crypto.randomUUID();car.km=km;car.uso={mot:driver.nome,dest:destination,quando:when,kmIni:car.km,trip_id:tripId,inspection_summary:{fuel:inspection.fuel,items:inspection.items,notes:inspection.notes}};
   S.log.push({quando:when,t:timestamp,placa:car.placa,tipo:'Saída',km,km_inicio:km,det:driver.nome+' → '+destination+' · combustível '+condition,foto:photo,inspection,trip_id:tripId});
  }else{
   const distance=km-car.uso.kmIni;S.log.push({quando:when,t:timestamp,placa:car.placa,tipo:'Devolução',km,km_inicio:car.uso.kmIni,km_fim:km,rodou:distance,det:car.uso.mot+' rodou '+fmt(distance)+' km · combustível '+condition,foto:photo,inspection,...(car.uso.trip_id?{trip_id:car.uso.trip_id}:{})});car.km=km;car.uso=null;
  }
  open=null;await save();render();
 }catch(error){syncStatus.textContent=error.message;}
}
document.addEventListener('change',async event=>{
 const input=event.target.closest('[data-inspection-photo]');if(!input)return;const file=input.files[0];if(!file)return;
 const panel=input.closest('.inspection-panel');touchedInspections.add(panel);clearInspectionError(panel);const draft=inspectionDraft(panel),side=input.dataset.inspectionPhoto,token=Symbol();draft.tokens[side]=token;draft.pending.add(token);delete draft.errors[side];
 const status=panel.querySelector(`[data-inspection-status="${side}"]`);status.textContent='Preparando foto…';
 try{const data=await compactInspectionPhoto(file);if(draft.tokens[side]!==token)return;draft.photos[side]=data;
  const preview=panel.querySelector(`[data-inspection-preview="${side}"]`);preview.innerHTML=`<button type="button" class="inspection-zoom" data-inspection-image="${esc(data)}" aria-label="Ampliar foto: ${FleetInspection.sides[side]}"><img src="${esc(data)}" alt="${FleetInspection.sides[side]}"></button>`;status.textContent='Foto pronta.';
 }catch(error){if(draft.tokens[side]!==token)return;delete draft.photos[side];draft.errors[side]=error.message;status.textContent=error.message;panel.querySelector(`[data-inspection-preview="${side}"]`).replaceChildren();}
 finally{draft.pending.delete(token);}
});
document.addEventListener('click',event=>{
 const remove=event.target.closest('[data-remove-inspection-photo]');if(remove){const panel=remove.closest('.inspection-panel');touchedInspections.add(panel);clearInspectionError(panel);const side=remove.dataset.removeInspectionPhoto,draft=inspectionDraft(panel);draft.tokens[side]=null;delete draft.photos[side];delete draft.errors[side];panel.querySelector(`[data-inspection-photo="${side}"]`).value='';panel.querySelector(`[data-inspection-preview="${side}"]`).replaceChildren();panel.querySelector(`[data-inspection-status="${side}"]`).textContent='Foto removida.';}
 const photo=event.target.closest('[data-inspection-image]');if(photo&&FleetInspection.photo(photo.dataset.inspectionImage,262144)){
  let dialog=document.querySelector('#inspection-photo-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='inspection-photo-dialog';dialog.setAttribute('aria-label','Foto da vistoria');dialog.innerHTML='<form method="dialog"><button class="btn sec">Fechar foto</button></form><img alt="Foto ampliada da vistoria">';dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});document.body.append(dialog);}
  dialog.querySelector('img').src=photo.dataset.inspectionImage;dialog.showModal();
 }
});
