let vehicleQRGeneration=0;
function clearVehicleQRPrint(){delete document.body.dataset.printVehicleQr;document.querySelector('#vehicle-qr-print')?.remove();}
function closeVehicleQR(){vehicleQRGeneration++;const dialog=document.querySelector('#vehicle-qr-dialog');if(dialog?.open)dialog.close();dialog?.remove();clearVehicleQRPrint();}
function qrCanvasText(ctx,text,y,size){ctx.font=`600 ${size}px sans-serif`;while(ctx.measureText(text).width>600&&size>12){size--;ctx.font=`600 ${size}px sans-serif`;}if(ctx.measureText(text).width>600){while(text.length&&ctx.measureText(text+'…').width>600)text=text.slice(0,-1);text+='…';}ctx.fillText(text,340,y);}
async function vehicleQRLabel(link,car,company){
 const raw=await FleetOnQRCode.toDataURL(link,{width:552,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}});
 const image=new Image();image.src=raw;await image.decode();
 const canvas=document.createElement('canvas');canvas.width=680;canvas.height=860;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,680,860);ctx.fillStyle='#0f172a';ctx.textAlign='center';qrCanvasText(ctx,company||'FleetOn',55,26);ctx.drawImage(image,64,96,552,552);qrCanvasText(ctx,String(car.placa),710,42);qrCanvasText(ctx,String(car.modelo||''),752,23);qrCanvasText(ctx,'Escaneie para acessar no FleetOn',802,20);return canvas.toDataURL('image/png');
}
async function openVehicleQR(id){
 if(cloud.context?.role!=='manager')return;
 const car=S.cars.find(c=>String(c.id)===String(id));if(!car)return;
 closeVehicleQR();const generation=++vehicleQRGeneration;
 const dialog=document.createElement('dialog');dialog.id='vehicle-qr-dialog';dialog.className='vehicle-qr-dialog';dialog.setAttribute('aria-labelledby','vehicle-qr-title');
 dialog.innerHTML=`<div class="row"><h2 id="vehicle-qr-title">QR Code · ${esc(car.placa)}</h2><button type="button" class="btn sec" id="close-vehicle-qr" aria-label="Fechar QR Code">Fechar</button></div><p class="settings-help">Imprima e coloque no veículo. O acesso exige login na empresa.</p><img id="vehicle-qr-image" alt="Etiqueta com QR Code do veículo ${esc(car.placa)}" hidden><label>Link do veículo<input id="vehicle-qr-link" readonly></label><div class="report-actions"><button type="button" class="btn" id="download-vehicle-qr" disabled>Baixar PNG</button><button type="button" class="btn sec" id="print-vehicle-qr" disabled>Imprimir etiqueta</button><button type="button" class="btn sec" id="copy-vehicle-qr" disabled>Copiar link</button></div><p id="vehicle-qr-status" role="status">Gerando QR Code…</p>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>{vehicleQRGeneration++;clearVehicleQRPrint();dialog.remove();});dialog.querySelector('#close-vehicle-qr').onclick=()=>dialog.close();dialog.showModal();
 try{
  const link=FleetQRLinks.url(location.origin,cloud.context.owner_id??cloud.context.user_id,car.id),company=companyState?.name||'',png=await vehicleQRLabel(link,car,company);
  if(generation!==vehicleQRGeneration||!dialog.isConnected)return;
  const image=dialog.querySelector('#vehicle-qr-image');image.src=png;image.hidden=false;dialog.querySelector('#vehicle-qr-link').value=link;dialog.querySelector('#vehicle-qr-status').textContent='Pronto para baixar ou imprimir.';
  for(const button of dialog.querySelectorAll('.report-actions button'))button.disabled=false;
  dialog.querySelector('#download-vehicle-qr').onclick=()=>{const a=document.createElement('a');a.href=png;a.download='fleeton-'+String(car.placa).replace(/[^a-zA-Z0-9_-]/g,'_')+'-qr.png';a.click();};
  dialog.querySelector('#copy-vehicle-qr').onclick=async()=>{try{await navigator.clipboard.writeText(link);dialog.querySelector('#vehicle-qr-status').textContent='Link copiado.';}catch{dialog.querySelector('#vehicle-qr-link').select();dialog.querySelector('#vehicle-qr-status').textContent='Selecione e copie o link acima.';}};
  dialog.querySelector('#print-vehicle-qr').onclick=async()=>{const button=dialog.querySelector('#print-vehicle-qr');button.disabled=true;try{clearVehicleQRPrint();const print=document.createElement('div');print.id='vehicle-qr-print';const img=new Image();img.src=png;img.alt='Etiqueta '+car.placa;await img.decode();if(!dialog.isConnected)return;print.append(img);document.body.append(print);document.body.dataset.printVehicleQr='true';window.print();}catch{clearVehicleQRPrint();dialog.querySelector('#vehicle-qr-status').textContent='Não foi possível imprimir. Baixe o PNG e tente imprimir a imagem.';}finally{button.disabled=false;}};
 }catch(error){if(generation===vehicleQRGeneration&&dialog.isConnected)dialog.querySelector('#vehicle-qr-status').textContent='Não foi possível gerar o QR Code. '+error.message;}
}
function applyVehicleQRTarget(){
 const target=FleetQRLinks.parse(location.href);if(!target||!cloud.csrf)return;
 if(isFleetEditing()){syncStatus.textContent='Há um veículo selecionado por QR Code. Termine a edição e use Atualizar dados para abri-lo.';return;}
 if(target.owner!==String(cloud.context?.owner_id??cloud.context?.user_id)){syncStatus.textContent='Este QR Code pertence a outra empresa. Entre com uma conta autorizada nessa empresa.';return;}
 const car=S.cars.find(c=>String(c.id)===target.id);if(!car){syncStatus.textContent='Veículo não encontrado nesta frota. Atualize os dados ou peça uma nova etiqueta ao gestor.';return;}
 if(cloud.context.role==='manager')openVehicleDetail(car.id);
 else{vehicleFilter={query:car.placa,status:'all',driver:'',id:car.id};cars();navigateLayout('car');document.querySelector('#car .car:not([hidden])')?.scrollIntoView({block:'nearest'});}
 syncStatus.textContent='Veículo '+car.placa+' selecionado pelo QR Code.';history.replaceState(null,'',location.pathname+location.search);
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-vehicle-qr]');if(button)void openVehicleQR(button.dataset.vehicleQr);});
window.addEventListener('hashchange',applyVehicleQRTarget);
window.addEventListener('afterprint',clearVehicleQRPrint);
