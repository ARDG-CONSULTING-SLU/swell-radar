// Swell Radar · actualizador de data.json
// Uso: node updater.js urls <pagina.html>            → URLs de oleaje y tiempo (Open-Meteo)
//      node updater.js ssturl <pagina.html>          → URL de la temperatura del agua (si la página la tiene)
//      node updater.js buoyurls <pagina.html>        → "id url" de cada boya (si la página tiene boyas)
//      node updater.js isourl <pagina.html>          → URL(s) del mapa de isobaras y del tiempo, una por línea (si la página lo tiene)
//      node updater.js build <pagina.html> <marine> <weather> <salida data.json> [id=fichero_boya ...] [iso=fichero1,fichero2 (en el orden de isourl)] [sst=fichero_agua]
// Ficheros: respuesta de Apify get-dataset-items (JSON con items[0].raw) o el JSON de la fuente tal cual.
const fs=require('fs');
const [,,mode,page,mf,wf,out,...rest]=process.argv;
const html=fs.readFileSync(page,'utf8');
const a=html.indexOf('const SPOTS'), b=html.indexOf('function agree(');
if(a<0||b<0) throw new Error('No encuentro el código de la página');
const code=html.slice(a,b).replace(/^const \$ = .*$/m,'');
const P=new Function(code+';return {SPOTS,MARINE_URL,WEATHER_URL,compact,BUOYS:typeof BUOYS!=="undefined"?BUOYS:[],buoyUrl:typeof buoyUrl!=="undefined"?buoyUrl:null,parseBuoy:typeof parseBuoy!=="undefined"?parseBuoy:null,ISO_URL:typeof ISO_URL!=="undefined"?ISO_URL:null,ISO_URLS:typeof ISO_URLS!=="undefined"?ISO_URLS:null,parseIso:typeof parseIso!=="undefined"?parseIso:null,SST_URL:typeof SST_URL!=="undefined"?SST_URL:null,parseSst:typeof parseSst!=="undefined"?parseSst:null};')();
function load(f){ let v=JSON.parse(fs.readFileSync(f,'utf8'));
  if(v && !Array.isArray(v) && v.items){ const raw=v.items[0] && v.items[0].raw; if(!raw) throw new Error(f+': sin campo raw'); v=JSON.parse(raw); }
  if(v && v.error) throw new Error(f+': error de la fuente '+v.reason); return v; }
if(mode==='urls'){ console.log(P.MARINE_URL); console.log(P.WEATHER_URL); }
else if(mode==='ssturl'){ if(P.SST_URL) console.log(P.SST_URL); }
else if(mode==='isourl'){ (P.ISO_URLS||(P.ISO_URL?[P.ISO_URL]:[])).forEach(u=>console.log(u)); }
else if(mode==='buoyurls'){ P.BUOYS.forEach(b=>console.log(b.id+' '+P.buoyUrl(b.id))); }
else if(mode==='build'){
  const m=load(mf), w=load(wf);
  const mA=Array.isArray(m)?m:[m], wA=Array.isArray(w)?w:[w];
  if(mA.length!==P.SPOTS.length||wA.length!==P.SPOTS.length) throw new Error(`Esperaba ${P.SPOTS.length} spots, llegan ${mA.length}/${wA.length}`);
  const d=P.compact(m,w);
  let ok=0; for(const s of P.SPOTS){ const h=d.spots[s.id].m.h; if(h.some(x=>x!=null)) ok++; }
  if(ok<P.SPOTS.length) throw new Error(`Solo ${ok}/${P.SPOTS.length} spots con datos de ola`);
  const bmsg=[];
  const isoArg=rest.find(a=>a.startsWith('iso=')), sstArg=rest.find(a=>a.startsWith('sst=')); const bArgs=rest.filter(a=>!a.startsWith('iso=')&&!a.startsWith('sst='));
  if(sstArg && P.parseSst){ try{ d.sst=P.parseSst(load(sstArg.slice(4))); bmsg.push('agua: '+Object.keys(d.sst.v).length+' spots desde '+d.sst.t0); }catch(e){ bmsg.push('agua: '+e.message); } }
  if(isoArg && P.parseIso){ try{ d.iso=P.parseIso(isoArg.slice(4).split(',').map(load)); bmsg.push('isobaras: '+d.iso.n+' pasos desde '+d.iso.t0); }catch(e){ bmsg.push('isobaras: '+e.message); } }
  if(P.parseBuoy && bArgs.length){ d.buoys={};
    for(const arg of bArgs){ const [id,file]=arg.split('='); try{ const o=P.parseBuoy(load(file)); if(o.t.length){ d.buoys[id]=o; bmsg.push(`${id}: ${o.t.length} h, última ${new Date(o.t[o.t.length-1]*1000).toISOString().slice(0,16)}Z ${o.h[o.h.length-1]} m`);} else bmsg.push(id+': sin filas'); }catch(e){ bmsg.push(id+': '+e.message); } } }
  fs.writeFileSync(out, JSON.stringify(d));
  console.log(`OK · ${P.SPOTS.length} spots · ${d.n} horas desde ${d.t0} · fetchedAt ${d.fetchedAt}`); bmsg.forEach(x=>console.log((x.startsWith('isobaras')||x.startsWith('agua')?'':'boya ')+x));
} else if(mode==='alert'){
  // node updater.js alert <pagina.html> <data.json> [oculto=id1,id2] → JSON (sin los spots ocultos): días (8–20 h, horas futuras) con fuegos, mismo criterio que la app:
  // 🔥 ola ≥0,6 m y periodo de pico ≥6 s · 🔥🔥 ≥1 m y ≥6 s · 🔥🔥🔥 ≥1,5 m y ≥6 s. Por día: fuegos (máximo), mejor hora y spots con fuego.
  const d=JSON.parse(fs.readFileSync(mf,'utf8'));
  const tier=(h,p)=>h>=1.5&&p>=6?3:h>=1&&p>=6?2:h>=0.6&&p>=6?1:0;
  const [date,hm]=d.t0.split('T'); const base=Date.parse(date+'T00:00:00Z'), h0=parseInt(hm);
  const nowLocal=new Date().toLocaleString('sv-SE',{timeZone:'Europe/Madrid'}).replace(' ','T').slice(0,13);
  const oc=new Set(((rest.concat(wf?[wf]:[])).find(a=>a&&a.startsWith('oculto='))||'oculto=').slice(7).split(',').filter(Boolean));
  const byDay={};
  for(const s of P.SPOTS){ const x=d.spots[s.id]; if(!x||oc.has(s.id)) continue;
    for(let i=0;i<d.n;i++){ const t=new Date(base+(h0+i*d.step)*3600e3).toISOString().slice(0,16); const hr=+t.slice(11,13);
      if(hr<8||hr>20||t.slice(0,13)<nowLocal) continue;
      const h=x.m.h[i], p=x.m.p[i]; if(h==null||p==null) continue; const f=tier(h,p);
      if(f){ const day=t.slice(0,10); (byDay[day]=byDay[day]||[]).push({id:s.id,spot:s.name,hora:t.slice(11,16),fuegos:f,h:+h.toFixed(2),p:+p.toFixed(1),e:+(0.981*h*h*p*p).toFixed(1)}); } } }
  const out=Object.keys(byDay).sort().map(day=>{ const L=byDay[day].sort((a,b)=>b.fuegos-a.fuegos||b.e-a.e); return {dia:day,fuegos:L[0].fuegos,mejor:L[0],spots:[...new Set(L.map(r=>r.spot))]}; });
  console.log(JSON.stringify(out,null,1));
} else { console.log('modo: urls | buoyurls | isourl | build | alert'); process.exit(1); }
