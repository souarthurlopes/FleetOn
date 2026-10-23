(function(root){
 function url(destination){
  if(typeof destination!=='string'||!destination.trim())return '';
  const link=new URL('https://www.google.com/maps/dir/');link.search=new URLSearchParams({api:'1',destination:destination.trim(),travelmode:'driving'}).toString();return link.href;
 }
 root.FleetMaps={url};
})(globalThis);
function vehicleRouteLink(car){const href=FleetMaps.url(car.uso?.dest);return href?`<a class="btn sec sm vehicle-route" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir rota de ${esc(car.placa)} no Google Maps">${ic('road')}Abrir rota no Google Maps</a>`:'';}
