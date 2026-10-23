let cloud = {csrf: '', version: 0, busy: false, blocked: false, dirty: false};
const account = document.querySelector('#account');
const syncStatus = document.querySelector('#sync-status');
const stateOnly = () => ({cars:S.cars, drivers:S.drivers, log:S.log, fines:S.fines});
async function api(path, body) {
  if(window.FleetOnRemote?.enabled) return FleetOnRemote.request(path,body);
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: {'Content-Type':'application/json', 'X-CSRF-Token':cloud.csrf},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível conectar.');
  return result;
}
function exportBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(stateOnly(), null, 2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='fleeton-backup.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function resetView(state) {
  S = {...state, role:cloud.context?.role==='driver'?'mot':'ges'};
  fineDueEdit=null;
  open=null; docOpen=null; ed=null; cmp=null; pcOpen=null; rvOpen=null;
  render();
}
async function saveCloud() {
  if(JSON.stringify(stateOnly())===cloud.lastState) return;
  cloud.dirty = true;
  try {
    const data = await api('fleet', {version:cloud.version, state:stateOnly()});
    cloud.version = data.version; cloud.dirty = false; cloud.lastState=JSON.stringify(stateOnly());
    syncStatus.textContent='Salvo no servidor.';
  } catch(error) {
    cloud.blocked=true;
    document.querySelector('#workspace').inert=true;
    syncStatus.textContent=error.message + ' Suas alterações continuam nesta tela. Exporte um backup antes de recarregar.';
  }
}
function authScreen() {
  closeVehicleQR();
  stopFleetSync();
  resetFleetTools();
  dashboardAnalyticsOpen=false;
  resetVehicleReports();
  companyState=null;companyError='';companyDraft=false;companySaving=false;displayCompany();
  layoutSignedOut();
  document.querySelector('#workspace').hidden=true;
  account.innerHTML=`<div class="panel" style="max-width:440px;margin:40px auto"><h2>Acesse sua frota</h2>
  <p>Entre com a mesma conta em outros dispositivos para acessar seus dados.</p>
  <form id="auth-form"><label>E-mail<input id="email" type="email" autocomplete="username" maxlength="254" required></label>
  <label>Senha<input id="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></label>
  <p>Use uma senha com pelo menos 10 caracteres.</p><div class="form"><button class="btn" type="submit">Entrar</button><button class="btn sec" type="submit" name="register" value="1">Criar conta</button></div>
  <button class="btn sec" id="reset-password" type="button" hidden>Esqueci minha senha</button><p id="auth-error" role="alert"></p></form></div>`;
  if(window.FleetOnRemote?.enabled) {
    document.querySelector('#reset-password').hidden=false;
    document.querySelector('#reset-password').onclick=async()=>{
      const email=document.querySelector('#email');
      if(!email.value || !email.reportValidity()) return;
      try{await api('reset',{email:email.value});document.querySelector('#auth-error').textContent='Se o endereço estiver cadastrado, você receberá um link para redefinir a senha. Abra-o neste mesmo navegador.';}
      catch(error){document.querySelector('#auth-error').textContent=error.message;}
    };
  }
  document.querySelector('#auth-form').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const creating=event.submitter?.name==='register';
    const body={email:document.querySelector('#email').value, password:document.querySelector('#password').value};
    form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const session=await api(creating?'register':'login',body);
      if(session.confirmationRequired) {
        document.querySelector('#auth-error').textContent='Confira seu e-mail para confirmar o cadastro. Depois volte para entrar. Abra o link neste mesmo navegador.';
        document.querySelector('#password').value='';
      } else await enter(session);
    }
    catch(error) { document.querySelector('#auth-error').textContent=error.message; }
    finally { form.querySelectorAll('button').forEach(b=>b.disabled=false); }
  };
}
async function enter(session) {
  if(window.FleetOnRemote?.recovering) {recoveryScreen();return;}
  stopFleetSync();
  cloud.csrf=session.csrf;
  cloud.context=await api('context');
  // Resolve the server-validated invitation before fetching or showing a fleet.
  if(window.FleetOnRemote?.enabled && cloud.context.invitation && cloud.context.role!=='driver') {
    cloud.context=await api('acceptInvite',{});
  }
  await loadCompany();
  const data=await api('fleet');
  cloud.version=data.version; cloud.blocked=false; cloud.dirty=false;
  resetView(data.state); cloud.lastState=JSON.stringify(stateOnly());
  paintAccount(session,cloud.context);
  displayCompany();
  document.querySelector('#workspace').hidden=false;
  document.querySelector('#workspace').inert=false;
  syncStatus.textContent='Dados carregados do servidor.';
  layoutSignedIn();
  applyVehicleQRTarget();
  if(document.querySelector('#backup'))document.querySelector('#backup').onclick=exportBackup;
  document.querySelector('#logout').onclick=async()=>{
    if(cloud.busy||companySaving) return;
    if(hasWorkspaceDraft()&&!hasInspectionDraft()&&!confirm('Há um formulário em edição. Sair descarta essas informações. Deseja continuar?'))return;
    if(hasInspectionDraft()&&!confirm('O checklist em edição ainda não foi registrado. Sair descarta essas informações. Deseja continuar?'))return;
    if(cloud.dirty && !confirm('Há alterações não salvas. Exporte um backup antes de sair. Deseja sair mesmo assim?')) return;
    stopFleetSync();
    try {await api('logout',{}); cloud.context=null; resetView({cars:[],drivers:[],log:[],fines:[]}); cloud.csrf=''; cloud.dirty=false; syncStatus.textContent=''; authScreen();}
    catch(error){syncStatus.textContent=error.message;startFleetSync();}
  };
  document.querySelector('#refresh').onclick=async()=>{
    if(cloud.busy||companySaving) return;
    if(hasWorkspaceDraft()&&!hasInspectionDraft()&&!confirm('Atualizar descarta as alterações do formulário em edição. Deseja continuar?'))return;
    if(hasInspectionDraft()&&!confirm('Atualizar descarta o checklist em edição. Deseja continuar?'))return;
    if(cloud.dirty && !confirm('Atualizar descarta as alterações não salvas. Já exportou o backup e deseja continuar?')) return;
    try{await enter(await api('session'));}catch(error){syncStatus.textContent=error.message;}
  };
  if(document.querySelector('#import'))document.querySelector('#import').onchange=async event=>{
    const file=event.target.files[0]; if(!file || cloud.busy || cloud.blocked) return;
    if(Object.values(stateOnly()).some(items=>items.length)) {syncStatus.textContent='A importação exige uma frota vazia para evitar substituir registros.'; return;}
    if(file.size>8*1024*1024) {syncStatus.textContent='Arquivo maior que 8 MB.'; return;}
    cloud.busy=true;
    try {
      const raw=JSON.parse(await file.text());
      const state={cars:raw.cars||[],drivers:raw.drivers||[],log:raw.log||[],fines:raw.fines||[]};
      const data=await api('fleet',{version:cloud.version,state});
      cloud.version=data.version; resetView(state); cloud.lastState=JSON.stringify(stateOnly()); syncStatus.textContent='Dados importados e salvos no servidor.';
    }catch(error){syncStatus.textContent=error.message;}
    finally{cloud.busy=false; event.target.value='';}
  };
  startFleetSync();
}
window.addEventListener('beforeunload',event=>{if(cloud.dirty||hasInspectionDraft()||hasWorkspaceDraft()){event.preventDefault();event.returnValue='';}});
function recoveryScreen() {
  stopFleetSync();
  layoutSignedOut();
  document.querySelector('#workspace').hidden=true;
  account.innerHTML=`<div class="panel"><h2>Crie uma nova senha</h2><form id="recovery-form"><label>Nova senha<input id="new-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><button class="btn" type="submit">Salvar senha</button><p id="recovery-error" role="alert"></p></form></div>`;
  document.querySelector('#recovery-form').onsubmit=async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{await api('password',{password:document.querySelector('#new-password').value});await enter(await api('session'));}
    catch(error){document.querySelector('#recovery-error').textContent=error.message;}
    finally{button.disabled=false;}
  };
}
window.addEventListener('fleeton-recovery',recoveryScreen);
(async()=>{
  if(window.FleetOnRemote?.enabled && !FleetOnRemote.configured) {
    document.querySelector('#workspace').hidden=true;
    account.innerHTML='<div class="panel"><h2>FleetOn</h2><p>A conexão com o banco ainda não foi configurada. O responsável pelo site precisa concluir a configuração do Supabase.</p></div>';
    return;
  }
  try {await enter(await api('session'));} catch(error) {
    authScreen();
    if(error.message !== 'Entre na sua conta.') document.querySelector('#auth-error').textContent=error.message;
  }
})();

async function driverTrip(action,car) {
  try {
    const km=FleetInspection.returnKm(document.querySelector(action==='in'?'#kmf':'#kmi').value,car.km);
    if(km===null)throw new Error(action==='in'?'Informe o km da devolução, igual ou maior que o da retirada.':'Informe o km da retirada, igual ou maior que o último registrado.');
    const inspection=await readInspection();
    const fleet=await api('inspectionTrip',{p_version:cloud.version,p_car_id:car.id,p_action:action,p_km:km,p_destination:action==='out'?document.querySelector('#dest').value.trim():'',p_checklist:inspection});
    cloud.version=fleet.version;resetView(fleet.state);cloud.lastState=JSON.stringify(stateOnly());syncStatus.textContent='Viagem registrada.';
  }catch(error){syncStatus.textContent=error.message;}
}
