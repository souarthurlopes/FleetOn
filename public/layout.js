const pageInfo={
 company:['Minha empresa','Identifique sua empresa para a equipe e os relatórios.'],
 dash:['Visão geral','Acompanhe sua frota em um só lugar.'],
 car:['Veículos','Disponibilidade, revisões e viagens da sua frota.'],
 drv:['Motoristas','Sua equipe pronta para seguir em frente.'],
 log:['Abastecimentos e manutenção','Cuide dos veículos e acompanhe os custos.'],
 fin:['Multas','Organize as infrações e os pagamentos.'],
 hist:['Histórico','Cada movimento da sua frota, registrado.'],
 alerts:['Central de alertas','Cuide dos vencimentos antes que virem imprevistos.'],
 reports:['Relatórios','Consulte, filtre e exporte os registros da sua frota.'],
 detail:['Detalhes do veículo','Viagens, fotos, documentos e custos em um só lugar.'],
 profile:['Meu perfil','Sua conta, sua equipe e suas preferências.']
};
let currentPage='dash', sidebarReturnFocus=null;
const mobileSidebar=matchMedia('(max-width:850px)');
const sidebar=document.querySelector('#app-sidebar');
document.querySelector('.sidebar-bottom').prepend(document.querySelector('#role'));
const originalBrand=document.querySelector('#workspace h1');
document.querySelector('#sidebar-brand').append(originalBrand);
const authBrand=document.createElement('div');authBrand.className='auth-brand';authBrand.append(originalBrand.cloneNode(true));document.querySelector('main').prepend(authBrand);
const navigation=document.querySelector('.tabs');navigation.setAttribute('aria-orientation','vertical');
document.querySelector('#sidebar-navigation').append(navigation);
document.querySelector('#profile-navigation').innerHTML=ic('users')+'<span>Meu perfil</span>';
document.querySelector('#driver-navigation').innerHTML=ic('car')+'<span>Veículos</span>';
function setSidebar(open) {
 document.body.classList.toggle('sidebar-open',open);
 sidebar.inert=mobileSidebar.matches&&!open;
 document.querySelector('#sidebar-backdrop').hidden=!open;
 const toggle=document.querySelector('#menu-toggle');toggle?.setAttribute('aria-expanded',String(open));
 if(open) {sidebarReturnFocus=document.activeElement;[...sidebar.querySelectorAll('button')].find(el=>!el.disabled&&el.getClientRects().length)?.focus();}
 else if(sidebarReturnFocus?.isConnected){sidebarReturnFocus.focus();sidebarReturnFocus=null;}
}
function updatePageHeading() {
 const [title,subtitle]=pageInfo[currentPage]||pageInfo.dash;
 if(document.querySelector('#page-title'))document.querySelector('#page-title').textContent=title;
 if(document.querySelector('#page-subtitle'))document.querySelector('#page-subtitle').textContent=subtitle;
}
function navigateLayout(page) {
 if(!cloud.csrf)return;
 currentPage=page;
 const profile=page==='profile';
 document.body.classList.toggle('profile-page',profile);
 const settings=document.querySelector('#account-settings');
 if(settings)settings.open=profile;
 document.querySelector('#workspace').hidden=profile;
 document.querySelector('#profile-navigation').setAttribute('aria-current',profile?'page':'false');
 document.querySelector('#driver-navigation').setAttribute('aria-current',page==='car'?'page':'false');
 navigation.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-selected',String(!profile&&b.dataset.t===(page==='detail'?'car':page))));
 if(!profile) ['dash','car','drv','log','fin','hist','alerts','reports','detail','company'].forEach(id=>document.querySelector('#'+id).hidden=id!==page);
 updatePageHeading();setSidebar(false);
}
function layoutAccount() {
 document.querySelector('#account-shortcut').replaceChildren(account.querySelector('.account-identity'));
 document.querySelector('#sidebar-signout').replaceChildren(account.querySelector('#logout'));
 const header=document.querySelector('.account-header');
 const intro=document.createElement('div');intro.className='page-intro';
 intro.innerHTML='<span class="page-eyebrow">GESTÃO DE FROTAS</span><h2 id="page-title"></h2><p id="page-subtitle"></p>';
 header.prepend(intro);
 const menu=document.createElement('button');menu.type='button';menu.className='menu-toggle btn sec';menu.id='menu-toggle';menu.setAttribute('aria-label','Abrir menu');menu.setAttribute('aria-controls','app-sidebar');menu.setAttribute('aria-expanded','false');menu.innerHTML='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
 header.prepend(menu);menu.onclick=()=>setSidebar(!document.body.classList.contains('sidebar-open'));
 const theme=document.createElement('button');theme.type='button';theme.className='btn sec theme-toggle';theme.setAttribute('aria-label','Alternar tema claro e escuro');theme.innerHTML='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>';
 theme.onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';try{localStorage.setItem('fleeton-theme',dark?'light':'dark');}catch{}};
 header.querySelector('.account-actions').prepend(theme);
 if(cloud.context?.role!=='driver') {
  const alerts=document.createElement('button');alerts.type='button';alerts.className='btn sec alerts-shortcut';alerts.id='alerts-shortcut';alerts.setAttribute('aria-label','Central de alertas');alerts.innerHTML=ic('alert')+'<span class="alert-count"></span>';
  alerts.onclick=()=>navigateLayout('alerts');header.querySelector('.account-actions').prepend(alerts);
 }
 const summary=document.querySelector('#account-settings > summary');
 summary.addEventListener('click',event=>{event.preventDefault();navigateLayout(currentPage==='profile'?(cloud.context?.role==='driver'?'car':'dash'):'profile');});
 updatePageHeading();
}
function layoutSignedIn() {
 document.body.classList.add('signed-in');sidebar.hidden=false;
 document.querySelector('#account-shortcut').disabled=false;
 const driver=cloud.context?.role==='driver';
 if(driver || currentPage==='profile')currentPage=driver?'car':'dash';
 navigateLayout(currentPage);renderAlertCenter();
}
function layoutSignedOut() {
 setSidebar(false);document.body.classList.remove('signed-in','profile-page');sidebar.hidden=true;
 document.querySelector('#account-shortcut').replaceChildren();document.querySelector('#sidebar-signout').replaceChildren();currentPage='dash';
}
document.addEventListener('click',event=>{
 const tab=event.target.closest('.tab');if(!tab || !cloud.csrf || cloud.context?.role==='driver')return;
 navigateLayout(tab.dataset.t);
},true);
document.querySelector('#profile-navigation').onclick=()=>navigateLayout('profile');
document.querySelector('#account-shortcut').onclick=()=>navigateLayout('profile');
document.querySelector('#driver-navigation').onclick=()=>navigateLayout('car');
document.querySelector('#sidebar-backdrop').onclick=()=>setSidebar(false);
document.addEventListener('keydown',event=>{
 if(!document.body.classList.contains('sidebar-open'))return;
 if(event.key==='Escape'){event.preventDefault();setSidebar(false);return;}
 if(event.key==='Tab') {
  const focusable=[...sidebar.querySelectorAll('button')].filter(el=>!el.disabled&&el.getClientRects().length);
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
});
try{document.documentElement.dataset.theme=localStorage.getItem('fleeton-theme')||'light';}catch{document.documentElement.dataset.theme='light';}

mobileSidebar.addEventListener('change',()=>setSidebar(false));
