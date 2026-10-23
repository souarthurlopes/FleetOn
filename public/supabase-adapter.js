// Integração via SDK oficial; a chave pública não concede acesso sem login/RLS.
window.FleetOnRemote = (() => {
  const config=window.FLEETON_CONFIG || {};
  const enabled=config.backend === 'supabase';
  let client, recovering=false;
  function connect() {
    if(client) return client;
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl || '') || !config.supabasePublishableKey) throw new Error('Configure a URL e a chave pública do Supabase antes de entrar.');
    const key=config.supabasePublishableKey;
    if(!key.startsWith('sb_publishable_')) {
      let claims;
      try {claims=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));} catch {}
      if(claims?.role !== 'anon') throw new Error('Use somente a chave pública publishable ou anon.');
    }
    client=FleetOnSupabase.createClient(config.supabaseUrl,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
    client.auth.onAuthStateChange(event=>{
      if(event==='PASSWORD_RECOVERY') {
        recovering=true;
        setTimeout(()=>window.dispatchEvent(new Event('fleeton-recovery')),0);
      }
    });
    return client;
  }
  function fail(error) {
    if(!error) return;
    const message=String(error.message || '');
    if(error.code==='PGRST202' && message.includes('fleeton_driver_odometer'))throw new Error('O gestor precisa executar 005_trip_odometer.sql no Supabase para ativar o km de retirada e devolução.');
    if(error.code==='PGRST202' && message.includes('fleeton_driver_inspection'))throw new Error('O gestor precisa executar a atualização 003_inspection.sql no Supabase para ativar o checklist dos motoristas.');
    const errors={INSPECTION_INVALID:'Confira o combustível, os itens e a descrição das avarias.',FLEET_FORBIDDEN:'Sua conta não tem permissão para essa ação.',PROFILE_INVALID:'Informe um nome de até 80 caracteres e uma foto válida.',EMAIL_INVALID:'Informe um e-mail válido.',TEAM_SELF:'Sua conta já é gestora desta frota.',TEAM_OTHER_FLEET:'Esse e-mail já participa de outra frota. Use uma conta nova ou vazia.',TEAM_ACTIVE_TRIP:'O motorista precisa devolver o veículo antes de ser removido.',TEAM_NO_INVITE:'Não há convite disponível. Confirme o e-mail da sua conta.',TRIP_INVALID:'Confira o destino e se você já está usando outro veículo.',TRIP_IN_USE:'Este veículo já está em uso. Atualize os dados.',TRIP_KM:'A quilometragem informada não pode ser menor que a registrada no veículo.'};
    for(const [code,text] of Object.entries(errors)) if(message.includes(code)) throw new Error(text);

    if(message.includes('FLEET_CONFLICT')) throw new Error('A frota mudou em outro dispositivo. Exporte suas alterações e atualize antes de editar.');
    if(message.includes('FLEET_INVALID')) throw new Error('Arquivo ou dados da frota inválidos. Verifique o backup.');
    if(message.includes('FLEET_TOO_LARGE')) throw new Error('Dados maiores que 8 MB. Exporte um backup e reduza as fotos.');
    if(message.includes('Invalid login credentials')) throw new Error('E-mail ou senha incorretos.');
    if(message.includes('Email not confirmed')) throw new Error('Confirme seu e-mail antes de entrar.');
    if(error.status===429) throw new Error('Muitas tentativas. Aguarde antes de tentar novamente.');
    if(message.includes('fetch')) throw new Error('Não foi possível conectar ao Supabase. Verifique sua conexão.');
    if(message.includes('function') || message.includes('schema cache')) throw new Error('O banco precisa ser configurado com a migração SQL do FleetOn.');
    throw new Error('Não foi possível concluir a operação. Confira a configuração e tente novamente.');
  }
  const sessionInfo=s=>({email:s.user.email,csrf:'supabase-session'});
  async function request(path,body) {
    const db=connect();
    if(path==='register') {
      const {data,error}=await db.auth.signUp({...body,options:{emailRedirectTo:location.origin+'/'}});fail(error);
      return data.session ? sessionInfo(data.session) : {confirmationRequired:true};
    }
    if(path==='login') {const {data,error}=await db.auth.signInWithPassword(body);fail(error);return sessionInfo(data.session);}
    if(path==='reset') {
      const {error}=await db.auth.resetPasswordForEmail(body.email,{redirectTo:location.origin+'/'});fail(error);return {};
    }
    if(path==='password') {const {error}=await db.auth.updateUser({password:body.password});fail(error);recovering=false;return {};}
    if(path==='logout') {const {error}=await db.auth.signOut({scope:'local'});fail(error);return {};}
    const {data:auth,error:authError}=await db.auth.getSession();fail(authError);
    if(!auth.session) throw new Error('Entre na sua conta.');
    if(path==='session') return sessionInfo(auth.session);
    const operations={fleetStatus:['fleeton_sync_status',{}],context:['fleeton_context',{}],profile:['fleeton_save_profile',{p_name:body?.name,p_avatar:body?.avatar}],team:['fleeton_team',{p_action:body?.action||'list',p_email:body?.email||''}],acceptInvite:['fleeton_accept_invite',{}],trip:['fleeton_driver_trip',body],inspectionTrip:['fleeton_driver_odometer',body]};
    if(operations[path]) {const [fn,args]=operations[path];const {data,error}=await db.rpc(fn,args);if(path==='fleetStatus' && error?.code==='PGRST202')throw Object.assign(new Error('Para ativar a atualização automática, execute 004_auto_sync.sql no Supabase e clique em Atualizar dados.'),{code:'SYNC_SETUP_REQUIRED'});if(path==='context' && error?.code==='PGRST202')return {role:'manager',profile:{name:'',avatar:''},migrationRequired:true};fail(error);return data;}
    if(path==='fleet') {
      if(body && new Blob([JSON.stringify(body.state)]).size>8*1024*1024) throw new Error('Dados maiores que 8 MB. Exporte um backup.');
      const {data,error}=await db.rpc(body ? 'fleeton_save_fleet' : 'fleeton_get_fleet',body ? {p_version:body.version,p_state:body.state} : {});
      fail(error);return data;
    }
    throw new Error('Operação desconhecida.');
  }
  return {enabled,configured:!!(config.supabaseUrl && config.supabasePublishableKey),request,get recovering(){return recovering;}};
})();
