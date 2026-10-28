// Swell Radar · actualización automática (GitHub Actions)
// 1) Descarga la previsión (Open-Meteo), el agua, los mapas y las boyas (Puertos del Estado)
// 2) Genera data.json con updater.js (mismo código que la app)
// 3) Envía las alertas de 🔥 por Brevo a la lista "Swell Radar", cada persona con sus spots
// Variables: BREVO_API_KEY (secreto), BREVO_LIST_ID (37), TEST_EMAIL (opcional: solo prueba a ese email),
//            SKIP_HOUR_CHECK=1 (lanzar a cualquier hora), NO_ALERTS=1
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), PAGE = path.join(ROOT, 'index.html'), TMP = path.join(ROOT, '.tmp');
const APP_URL = 'https://ardg-consulting-slu.github.io/swell-radar/';
const SENDER = { name: 'Swell Radar', email: 'hola@ardgconsulting.es' };
const LIST_ID = +(process.env.BREVO_LIST_ID || 37);
const TEST_EMAIL = (process.env.TEST_EMAIL || '').trim();
const STATE = path.join(ROOT, '.alerts', 'state.json');

const madrid = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T');
const upd = (...a) => execFileSync('node', [path.join(ROOT, 'updater.js'), ...a], { cwd: ROOT, encoding: 'utf8' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 3) {
  for (let k = 1; k <= tries; k++) {
    try { const r = await fetch(url, { headers: { 'user-agent': 'SwellRadar/1.0 (ardgconsulting.es)' } }); if (r.ok) return await r.text(); throw new Error('HTTP ' + r.status); }
    catch (e) { if (k === tries) throw e; await sleep(4000 * k); }
  }
}

(async () => {
  const now = madrid(), hr = +now.slice(11, 13);
  if (!process.env.SKIP_HOUR_CHECK && !TEST_EMAIL && ![6, 13, 19].includes(hr)) { console.log(`Hora de Madrid ${now}: no toca (6, 13 o 19 h). Salgo.`); return; }
  fs.mkdirSync(TMP, { recursive: true });
  if (!process.env.SKIP_FETCH) {
  const f = n => path.join(TMP, n);

  // ---- 1. descargas
  const [mUrl, wUrl] = upd('urls', PAGE).trim().split('\n');
  fs.writeFileSync(f('marine.json'), await get(mUrl));
  fs.writeFileSync(f('weather.json'), await get(wUrl));
  const extra = [];
  try { const u = upd('ssturl', PAGE).trim(); if (u) { fs.writeFileSync(f('sst.json'), await get(u)); extra.push('sst=' + f('sst.json')); } } catch (e) { console.log('agua: ' + e.message); }
  try { const us = upd('isourl', PAGE).trim().split('\n').filter(Boolean); const fs2 = [];
    for (let i = 0; i < us.length; i++) { fs.writeFileSync(f('iso' + i + '.json'), await get(us[i])); fs2.push(f('iso' + i + '.json')); }
    if (fs2.length) extra.push('iso=' + fs2.join(',')); } catch (e) { console.log('mapas: ' + e.message); }
  try { for (const line of upd('buoyurls', PAGE).trim().split('\n').filter(Boolean)) { const [id, u] = line.split(' ');
      try { fs.writeFileSync(f(id + '.json'), await get(u, 2)); extra.push(`${id}=${f(id + '.json')}`); } catch (e) { console.log(`boya ${id}: ${e.message}`); } } } catch (e) { console.log('boyas: ' + e.message); }

  // ---- 2. data.json
  console.log(upd('build', PAGE, f('marine.json'), f('weather.json'), path.join(ROOT, 'data.json'), ...extra).trim());
  }
  if (process.env.NO_ALERTS) return;

  // ---- 3. alertas por Brevo
  const KEY = process.env.BREVO_API_KEY; if (!KEY) { console.log('Sin BREVO_API_KEY: no envío alertas.'); return; }
  const html = fs.readFileSync(PAGE, 'utf8'); const a = html.indexOf('const SPOTS'), b = html.indexOf('function agree(');
  const SPOTS = new Function(html.slice(a, b).replace(/^const \$ = .*$/m, '') + ';return SPOTS;')();
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const byName = Object.fromEntries(SPOTS.map(s => [norm(s.name), s.id]));
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const tier = (h, p) => h >= 1.5 && p >= 6 ? 3 : h >= 1 && p >= 6 ? 2 : h >= 0.6 && p >= 6 ? 1 : 0;
  const [date, hm] = d.t0.split('T'); const base = Date.parse(date + 'T00:00:00Z'), h0 = parseInt(hm), nowH = now.slice(0, 13);
  function fires(ids) { const byDay = {};
    for (const s of SPOTS) { if (!ids.includes(s.id)) continue; const x = d.spots[s.id]; if (!x) continue;
      for (let i = 0; i < d.n; i++) { const t = new Date(base + (h0 + i * d.step) * 3600e3).toISOString().slice(0, 16), hr2 = +t.slice(11, 13);
        if (hr2 < 8 || hr2 > 20 || t.slice(0, 13) < nowH) continue; const h = x.m.h[i], p = x.m.p[i]; if (h == null || p == null) continue; const fz = tier(h, p);
        if (fz) (byDay[t.slice(0, 10)] = byDay[t.slice(0, 10)] || []).push({ spot: s.name, hora: t.slice(11, 16), fuegos: fz, h, p, e: 0.981 * h * h * p * p }); } }
    return Object.keys(byDay).sort().map(day => { const L = byDay[day].sort((x, y) => y.fuegos - x.fuegos || y.e - x.e); return { dia: day, fuegos: L[0].fuegos, mejor: L[0], spots: [...new Set(L.map(r => r.spot))] }; }); }
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fmt = (v, k = 1) => v.toFixed(k).replace('.', ',');
  const dayName = s => { const z = new Date(s + 'T12:00:00Z'); return `${DAYS[z.getUTCDay()]} ${z.getUTCDate()}/${z.getUTCMonth() + 1}`; };
  const upd2 = new Date(d.fetchedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mail = (name, days) => `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0a2430;max-width:560px">
<p style="font-size:22px;font-weight:800;color:#ee4f2c;margin:0 0 6px">Swell Radar</p><p>Hola, ${esc(name || 'surfer')}:</p>
${days.map(x => `<p style="margin:14px 0 4px"><b>${'🔥'.repeat(x.fuegos)} ${dayName(x.dia)}</b></p>
<p style="margin:0">Mejor: <b>${esc(x.mejor.spot)}</b> a las ${x.mejor.hora} · ${fmt(x.mejor.h)} m · ${fmt(x.mejor.p)} s · ${fmt(x.mejor.e)} kJ</p>
${x.spots.length > 1 ? `<p style="margin:2px 0 0;color:#3d6470">También con fuego: ${x.spots.filter(s => s !== x.mejor.spot).map(esc).join(', ')}</p>` : ''}`).join('')}
<p style="margin-top:18px;color:#3d6470;font-size:13px">Última actualización de la previsión: ${upd2}</p>
<p><a href="${APP_URL}" style="display:inline-block;background:#ee4f2c;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px">Abrir Swell Radar</a></p>
<p style="color:#6a8b93;font-size:12px">Recibes este aviso porque te registraste en Swell Radar. Para dejar de recibirlo, responde a este email con la palabra BAJA.</p></div>`;
  async function brevo(method, url, body) {
    const r = await fetch('https://api.brevo.com/v3' + url, { method, headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); if (!r.ok) throw new Error(`Brevo ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {};
  }
  async function send(to, name, days, test) {
    const max = Math.max(...days.map(x => x.fuegos));
    await brevo('POST', '/smtp/email', { sender: SENDER, to: [{ email: to, name: name || undefined }], subject: (test ? '[Prueba] ' : '') + '🔥'.repeat(max) + ' Swell Radar', htmlContent: mail(name, days) });
  }

  if (TEST_EMAIL) { // prueba: todos los spots, sin tocar el registro de avisos
    let days = fires(SPOTS.map(s => s.id));
    if (!days.length) days = [{ dia: now.slice(0, 10), fuegos: 1, mejor: { spot: '(ejemplo, hoy no hay fuegos)', hora: '--:--', h: 0, p: 0, e: 0 }, spots: [] }];
    await send(TEST_EMAIL, 'prueba', days, true); console.log('Prueba enviada a ' + TEST_EMAIL); return;
  }

  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) {}
  const today = now.slice(0, 10); for (const k of Object.keys(state)) if (k.slice(0, 10) < today) delete state[k];
  const contacts = []; for (let off = 0; ; off += 500) { const r = await brevo('GET', `/contacts/lists/${LIST_ID}/contacts?limit=500&offset=${off}`); contacts.push(...(r.contacts || [])); if (!r.contacts || r.contacts.length < 500) break; }
  let sent = 0;
  for (const c of contacts) {
    if (c.emailBlacklisted) continue;
    const at = c.attributes || {}; let sp = at.SPOTS_SWELL_RADAR; if (typeof sp === 'string') sp = sp.split(/\s*[|;]\s*|,\s(?=[A-ZÁÉÍÓÚ])/);
    let ids = (Array.isArray(sp) ? sp : []).map(x => byName[norm(x)]).filter(Boolean); if (!ids.length) ids = SPOTS.map(s => s.id);
    const nuevos = fires(ids).filter(x => (state[`${x.dia}|${c.email}`] || 0) < x.fuegos);
    if (!nuevos.length) continue;
    try { await send(c.email, at.NOMBRE || at.FIRSTNAME || '', nuevos, false); nuevos.forEach(x => state[`${x.dia}|${c.email}`] = x.fuegos); sent++; console.log(`Aviso a ${c.email}: ${nuevos.map(x => x.dia + ' ' + '🔥'.repeat(x.fuegos)).join(', ')}`); }
    catch (e) { console.log(`Fallo con ${c.email}: ${e.message}`); }
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  console.log(`Contactos en la lista: ${contacts.length} · avisos enviados: ${sent}`);
})().catch(e => { console.error(e); process.exit(1); });
