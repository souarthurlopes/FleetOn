function profileDisplay(session,context) {
  const name=context.profile?.name?.trim() || session.email.split('@')[0];
  document.querySelector('#profile-name').textContent=name;
  document.querySelector('#user-email').textContent=session.email;
  document.querySelector('#profile-role').textContent=context.role==='driver'?'Motorista':'Gestor';
  const avatar=document.querySelector('#profile-avatar');avatar.replaceChildren();
  const image=context.profile?.avatar || '';
  if(image.length<=65536 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) {
    const img=new Image();img.alt='Foto de perfil';img.src=image;avatar.append(img);
  }else avatar.textContent=name.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('').toUpperCase();
}
async function profilePhoto(file) {
  if(!file || !file.type.startsWith('image/') || file.size>5*1024*1024) throw new Error('Escolha uma imagem de até 5 MB.');
  const image=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const size=Math.min(image.width,image.height), ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,128,128);
    ctx.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,128,128);
    return canvas.toDataURL('image/jpeg',.8);
  }finally{image.close();}
}
function paintAccount(session,context) {
  const manager=context.role!=='driver';
  account.innerHTML=`<header class="account-header"><div class="account-identity"><span class="profile-avatar" id="profile-avatar" aria-hidden="true"></span><div class="identity-text"><strong id="profile-name"></strong><span id="user-email"></span><span class="profile-role" id="profile-role"></span></div></div><div class="account-actions"><button class="btn sec" id="refresh">Atualizar dados</button><button class="btn sec" id="logout">Sair</button></div></header>
  <details id="account-settings" class="account-settings"><summary>Minha conta</summary><div class="settings-grid"><section class="panel"><h2>Meu perfil</h2><form id="profile-form"><label>Nome<input id="edit-name" maxlength="80" autocomplete="name" required></label><label>Foto de perfil<input id="edit-avatar" type="file" accept="image/*"></label><p class="settings-help">Foto de até 5 MB. Seu perfil acompanha a conta em outros dispositivos.</p><div class="account-actions"><button class="btn" type="submit">Salvar perfil</button><button class="btn sec" type="button" id="remove-avatar">Remover foto</button></div><p id="profile-status" role="status"></p></form></section>
  ${manager?'<section class="panel"><h2>Dados da frota</h2><button class="btn sec" id="backup">Exportar backup</button><label>Importar backup (JSON)<input id="import" type="file" accept="application/json,.json"></label><p class="settings-help">Para importar, a frota precisa estar vazia.</p></section>':''}
  ${manager && window.FleetOnRemote?.enabled?'<section class="panel"><h2>Equipe</h2><form id="invite-form"><label>E-mail do motorista<input id="invite-email" type="email" required maxlength="254"></label><button class="btn" type="submit">Convidar motorista</button></form><p class="settings-help">O motorista cria a conta, confirma o e-mail e aceita o convite ao entrar. Nenhum e-mail é enviado por este botão.</p><p id="team-status" role="status"></p><div id="team-list"></div></section>':''}
  </div></details><div id="invite-notice"></div>`;
  layoutAccount();
  profileDisplay(session,context);
  const input=document.querySelector('#edit-name');input.value=context.profile?.name||session.email.split('@')[0];
  if(context.migrationRequired) {
    document.querySelector('#profile-status').textContent='Para ativar perfis e permissões, execute a atualização 002_profiles_roles.sql no Supabase.';
    document.querySelectorAll('#profile-form input,#profile-form button,#invite-form input,#invite-form button').forEach(e=>e.disabled=true);
  }
  document.querySelector('#remove-avatar').onclick=()=>{
    context.removeAvatar=true;document.querySelector('#edit-avatar').value='';
    document.querySelector('#profile-status').textContent='Clique em Salvar perfil para confirmar a remoção.';
  };
  document.querySelector('#profile-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;
    try {
      const file=document.querySelector('#edit-avatar').files[0];
      const avatar=file?await profilePhoto(file):context.removeAvatar?'':context.profile?.avatar||'';
      context.profile=await api('profile',{name:input.value.trim(),avatar});context.removeAvatar=false;
      profileDisplay(session,context);document.querySelector('#edit-avatar').value='';
      document.querySelector('#profile-status').textContent='Perfil salvo.';
      if(context.role==='driver' && !cloud.busy && !cloud.dirty) {const fleet=await api('fleet');cloud.version=fleet.version;resetView(fleet.state);cloud.lastState=JSON.stringify(stateOnly());}
    }catch(error){document.querySelector('#profile-status').textContent=error.message;}
    finally{button.disabled=false;}
  };
  const notice=document.querySelector('#invite-notice');
  if(context.invitation) {
    const p=document.createElement('p');p.textContent='Convite para atuar como motorista na frota de '+context.invitation.email;
    const accept=document.createElement('button');accept.className='btn';accept.textContent='Aceitar convite';
    accept.onclick=async()=>{
      if(cloud.busy || cloud.dirty){syncStatus.textContent='Salve ou exporte suas alterações antes de aceitar.';return;}
      accept.disabled=true;
      try{await api('acceptInvite',{});await enter(await api('session'));}
      catch(error){syncStatus.textContent=error.message;accept.disabled=false;}
    };
    notice.append(p,accept);
  }
  if(document.querySelector('#invite-form') && !context.migrationRequired) {
    const status=document.querySelector('#team-status');
    const paintTeam=data=>{
      const list=document.querySelector('#team-list');list.replaceChildren();
      for(const member of [...data.members.map(x=>({...x,pending:false})),...data.invites.map(x=>({...x,pending:true}))]) {
        const row=document.createElement('div');row.className='team-row';
        const label=document.createElement('span');label.textContent=(member.name?member.name+' · ':'')+member.email+(member.pending?' · Convite pendente':' · Motorista');
        const remove=document.createElement('button');remove.type='button';remove.className='btn sec';remove.textContent=member.pending?'Cancelar convite':'Remover acesso';
        remove.onclick=async()=>{
          if(!confirm('Remover o acesso/convite de '+member.email+'?'))return;
          remove.disabled=true;
          try{paintTeam(await api('team',{action:'remove',email:member.email}));status.textContent='Acesso removido.';}
          catch(error){status.textContent=error.message;remove.disabled=false;}
        };
        row.append(label,remove);list.append(row);
      }
      if(!list.childElementCount)list.textContent='Nenhum motorista convidado.';
    };
    document.querySelector('#invite-form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
      try{paintTeam(await api('team',{action:'invite',email:document.querySelector('#invite-email').value.trim()}));form.reset();status.textContent='Convite disponível. Peça ao motorista para entrar e aceitar com esse e-mail.';}
      catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}
    };
    api('team',{}).then(paintTeam).catch(error=>{status.textContent=error.message;});
  }
}
