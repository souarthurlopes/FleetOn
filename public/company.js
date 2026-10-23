let companyState=null,companyError='',companyDraft=false,companySaving=false,companyRemoveLogo=false;
async function loadCompany(){companyState=null;companyError='';companyDraft=false;companyRemoveLogo=false;try{companyState=await api('company');}catch(error){companyError=error.message;}}
function companyLogoHTML(){return companyState?.logo&&companyState.logo.length<=65536&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(companyState.logo)?`<img src="${companyState.logo}" alt="Logo da empresa">`:'';}
function companyPrintHeading(){return companyState?`<div class="company-print-heading">${companyLogoHTML()}<div><h2>${esc(companyState.name)}</h2>${companyState.cnpj?`<p>CNPJ: ${esc(companyState.cnpj)}</p>`:''}${companyState.phone?`<p>${esc(companyState.phone)}</p>`:''}${companyState.address?`<p>${esc(companyState.address)}</p>`:''}</div></div>`:'';}
function displayCompany(){
 let brand=document.querySelector('#company-identity');
 if(!brand&&document.querySelector('.page-intro')){brand=document.createElement('div');brand.id='company-identity';document.querySelector('.page-intro').prepend(brand);}
 if(brand){brand.hidden=!companyState;brand.innerHTML=companyState?`${companyLogoHTML()}<strong>${esc(companyState.name)}</strong>`:'';}
}
function renderCompany(){
 const section=document.querySelector('#company');if(!section)return;
 if(cloud.context?.role!=='manager'){section.replaceChildren();return;}
 if(companyDraft&&section.querySelector('#company-form'))return;
 companyRemoveLogo=false;
 section.innerHTML=`<div class="panel company-panel"><h3>Dados da empresa</h3><p class="settings-help">Esta identificação acompanha a sua frota e aparece para os motoristas e nos relatórios impressos.</p><form id="company-form"><label>Nome da empresa<input id="company-name" maxlength="120" required autocomplete="organization"></label><div class="company-fields"><label>CNPJ (opcional)<input id="company-cnpj" maxlength="18" placeholder="00.000.000/0000-00"></label><label>Telefone (opcional)<input id="company-phone" maxlength="30" autocomplete="tel"></label></div><label>Endereço (opcional)<input id="company-address" maxlength="300" autocomplete="street-address"></label><label>Logo da empresa<input id="company-logo" type="file" accept="image/*"></label><p class="settings-help">Imagem de até 5 MB. A logo será ajustada mantendo suas proporções.</p><div id="company-logo-preview">${companyLogoHTML()}</div><div class="report-actions"><button type="submit" class="btn">Salvar empresa</button><button type="button" class="btn sec" id="company-remove-logo">Remover logo</button></div><p id="company-status" role="status"></p></form></div>`;
 for(const key of ['name','cnpj','phone','address'])document.querySelector('#company-'+key).value=companyState?.[key]||'';
 document.querySelector('#company-status').textContent=companyError;
 section.querySelectorAll('input,button').forEach(el=>el.disabled=!!companyError||companySaving);
 document.querySelector('#company-remove-logo').onclick=()=>{companyRemoveLogo=true;companyDraft=true;document.querySelector('#company-logo').value='';document.querySelector('#company-logo-preview').replaceChildren();document.querySelector('#company-status').textContent='Clique em Salvar empresa para confirmar a remoção.';};
 document.querySelector('#company-form').onsubmit=saveCompany;
}
async function companyPhoto(file){
 if(!file.type.startsWith('image/')||file.size>5*1024*1024)throw new Error('Escolha uma imagem de até 5 MB.');
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('Não foi possível abrir a imagem. Escolha outra logo.');}
 try{const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);for(const quality of [.85,.65,.45]){const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=65536)return result;}throw new Error('A imagem é muito detalhada. Escolha uma logo mais simples.');}finally{bitmap.close();}
}
async function saveCompany(event){
 event.preventDefault();if(companySaving||cloud.busy||cloud.blocked||cloud.context?.role!=='manager')return;
 const status=document.querySelector('#company-status'),form=event.currentTarget,data={};
 for(const key of ['name','cnpj','phone','address'])data[key]=document.querySelector('#company-'+key).value.trim();
 if(!data.name){status.textContent='Informe o nome da empresa.';return;}
 if(data.cnpj&&!/^(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(data.cnpj)){status.textContent='Informe o CNPJ com 14 dígitos, com ou sem pontuação.';return;}
 const file=document.querySelector('#company-logo').files[0];companySaving=true;form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
 try{data.logo=file?await companyPhoto(file):companyRemoveLogo?'':companyState?.logo||'';companyState=await api('company',data);companyDraft=false;companyRemoveLogo=false;renderCompany();displayCompany();document.querySelector('#company-status').textContent='Empresa salva.';}
 catch(error){status.textContent=error.message;}
 finally{companySaving=false;form.querySelectorAll('input,button').forEach(el=>el.disabled=false);document.querySelectorAll('#company-form input,#company-form button').forEach(el=>el.disabled=false);}
}
document.addEventListener('input',e=>{if(e.target.closest('#company-form'))companyDraft=true;});
document.addEventListener('change',e=>{if(e.target.closest('#company-form'))companyDraft=true;});
