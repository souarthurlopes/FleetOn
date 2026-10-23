/* Poll metadata only; full fleets (including photos) are fetched only on change. */
let fleetSyncTimer=null,fleetSyncGeneration=0,fleetSyncPending=false,fleetSyncRunning=false;
let fleetSyncFailures=0,fleetSyncLastCheck=0,fleetSyncSetupRequired=false,fleetEditEpoch=0,fleetDraftEdited=false;
const FLEET_SYNC_INTERVAL=20000;
function hasWorkspaceDraft(){return fleetDraftEdited||companyDraft;}
function isFleetEditing(){
 const focus=document.activeElement;
 return companySaving||cloud.busy||cloud.dirty||cloud.blocked||hasWorkspaceDraft()||hasInspectionDraft()||open!==null||docOpen!==null||pcOpen!==null||rvOpen!==null||ed!==null||cmp!==null||driverCnhEdit!==null||fineDueEdit!==null||
  (!!focus?.closest('#workspace')&&focus.matches('input,select,textarea'));
}
function isFleetViewControl(element){return !!element.closest('#company-form')||['vehicle-search','vehicle-status','vehicle-driver','alert-category','alert-severity','report-from','report-to','report-vehicle','report-driver','report-kind'].includes(element.id);}
function syncIndicator(message,state='live'){
 const node=document.querySelector('#auto-sync-status');node.hidden=false;node.textContent=message;node.dataset.state=state;
}
function stopFleetSync(){
 clearTimeout(fleetSyncTimer);fleetSyncTimer=null;fleetSyncGeneration++;fleetSyncRunning=false;fleetSyncPending=false;
 const node=document.querySelector('#auto-sync-status');if(node)node.hidden=true;
}
function startFleetSync(){
 stopFleetSync();fleetSyncFailures=0;fleetSyncSetupRequired=false;fleetSyncLastCheck=Date.now();
 if(!cloud.csrf||cloud.context?.role!=='manager')return;
 if(cloud.context.migrationRequired){syncIndicator('Conclua a atualização dos perfis para ativar a atualização automática.','pending');return;}
 syncIndicator('Atualização automática · verificação a cada 20 segundos');
 scheduleFleetSync();
}
function scheduleFleetSync(){
 clearTimeout(fleetSyncTimer);
 if(typeof cloud==='undefined'||!cloud.csrf||cloud.context?.role!=='manager'||fleetSyncSetupRequired||cloud.blocked)return;
 const generation=fleetSyncGeneration;
 fleetSyncTimer=setTimeout(async()=>{await pollFleetStatus();if(generation===fleetSyncGeneration)scheduleFleetSync();},Math.min(FLEET_SYNC_INTERVAL*2**fleetSyncFailures,120000));
}
async function pollFleetStatus(){
 if(typeof cloud==='undefined'||fleetSyncRunning||fleetSyncSetupRequired||document.hidden||!cloud.csrf||cloud.context?.role!=='manager')return;
 if(cloud.busy||cloud.dirty||cloud.blocked){syncIndicator('Atualização automática pausada durante a edição.','paused');return;}
 const generation=fleetSyncGeneration,context=cloud.context,version=cloud.version;
 const stillCurrent=()=>generation===fleetSyncGeneration&&context===cloud.context&&!!cloud.csrf;
 fleetSyncRunning=true;fleetSyncLastCheck=Date.now();
 try{
  const status=await api('fleetStatus');if(!stillCurrent())return;
  if(status.role!==context.role||String(status.owner_id)!==String(context.owner_id??context.user_id)){
   cloud.blocked=true;document.querySelector('#workspace').inert=true;
   syncIndicator('Seu acesso à frota mudou. Use Atualizar dados para continuar.','pending');return;
  }
  if(!Number.isSafeInteger(status.version)||status.version<0)throw new Error('Versão inválida.');
  fleetSyncFailures=0;
  if(version!==cloud.version)return;
  if(status.version===cloud.version){fleetSyncPending=false;syncIndicator(isFleetEditing()?'Atualização automática pausada durante a edição.':`Frota verificada às ${syncClock()}`,isFleetEditing()?'paused':'live');return;}
  fleetSyncPending=true;
  if(isFleetEditing()){syncIndicator('Há novidades na frota. Termine a edição ou use Atualizar dados.','pending');return;}
  const epoch=fleetEditEpoch,lastState=cloud.lastState;
  const data=await api('fleet');if(!stillCurrent())return;
  if(version!==cloud.version||epoch!==fleetEditEpoch||lastState!==cloud.lastState||isFleetEditing()){
   syncIndicator('Há novidades na frota. Termine a edição ou use Atualizar dados.','pending');return;
  }
  if(!Number.isSafeInteger(data.version)||data.version<Math.max(status.version,cloud.version))throw new Error('Versão desatualizada.');
  const viewRole=S.role,selection=window.scrollY;
  resetView(data.state);S.role=viewRole;rolebar();cloud.version=data.version;cloud.lastState=JSON.stringify(stateOnly());fleetSyncPending=false;
  window.scrollTo({top:selection,behavior:'instant'});
  syncIndicator(`Frota atualizada automaticamente às ${syncClock()}`);
 }catch(error){
  if(!stillCurrent())return;
  fleetSyncFailures=Math.min(fleetSyncFailures+1,3);
  if(error.code==='SYNC_SETUP_REQUIRED'){fleetSyncSetupRequired=true;syncIndicator(error.message,'pending');}
  else syncIndicator('Não foi possível verificar a frota. Exibindo os dados anteriores; tentaremos novamente.','offline');
 }finally{if(stillCurrent())fleetSyncRunning=false;}
}
function syncClock(){return new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'});}
for(const event of ['input','change'])document.addEventListener(event,e=>{
 if(e.target.closest('#workspace')&&e.target.matches('input,select,textarea')&&!isFleetViewControl(e.target)){
  fleetDraftEdited=true;fleetEditEpoch++;
  if(cloud.csrf&&cloud.context?.role==='manager')syncIndicator(fleetSyncPending?'Há novidades na frota. Termine a edição ou use Atualizar dados.':'Atualização automática pausada durante a edição.',fleetSyncPending?'pending':'paused');
 }
});
function resumeFleetSync(){
 if(typeof cloud!=='undefined'&&!document.hidden&&navigator.onLine&&Date.now()-fleetSyncLastCheck>=5000){void pollFleetStatus().finally(scheduleFleetSync);}
}
document.addEventListener('visibilitychange',resumeFleetSync);
window.addEventListener('focus',resumeFleetSync);
window.addEventListener('online',()=>{fleetSyncFailures=0;resumeFleetSync();});
