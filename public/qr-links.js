(function(root){
 function url(origin,owner,id){
  if(owner===undefined||owner===null||String(owner)===''||!Number.isFinite(Number(id)))throw new Error('Veículo sem identificação válida. Atualize os dados.');
  const link=new URL('/',origin);if(!['https:','http:'].includes(link.protocol))throw new Error('Endereço do aplicativo inválido.');
  link.hash=new URLSearchParams({vehicle:String(id),fleet:String(owner)}).toString();return link.href;
 }
 function parse(value){
  try{const params=new URLSearchParams(new URL(value).hash.slice(1)),id=params.get('vehicle'),owner=params.get('fleet');
   if(id===null||!id.trim()||!Number.isFinite(Number(id))||!owner||owner.length>100||id.length>100)return null;
   return {id,owner};
  }catch{return null;}
 }
 root.FleetQRLinks={url,parse};
})(globalThis);
