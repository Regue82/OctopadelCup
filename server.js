// OctopadelApp: estáticos + API de torneos en tiempo real (SSE). Railway define PORT y DATABASE_URL.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createStore } = require('./store');
const VERSION = require('./package.json').version;
const COMMIT = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7);

const ROOT = path.join(__dirname, 'public');
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json','.ico':'image/x-icon'};
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
// Acceso del organizador (de momento, en crudo). Se puede cambiar con variables de Railway: ADMIN_USER y ADMIN_PASS.
const ADMIN_USER = (process.env.ADMIN_USER || 'regue').toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASS || 'Dar3ga';
const KEY = crypto.createHash('sha256').update('octopadel|' + ADMIN_PASS).digest();
const sign = s => crypto.createHmac('sha256', KEY).update(s).digest('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const mkToken = () => { const p = Buffer.from(JSON.stringify({ u: ADMIN_USER, e: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
function isAdmin(req) {
  const h = req.headers.authorization || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [p, sg] = t.split('.'); if (!p || !sg) return false;
  try { if (!crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(sign(p)))) return false; return JSON.parse(Buffer.from(p, 'base64url')).e > Date.now(); } catch (e) { return false; }
}
const fails = new Map(); // ip -> {n, t}  (límite de intentos de login)
function blocked(ip) { const f = fails.get(ip); if (!f) return false; if (Date.now() - f.t > 10 * 60e3) { fails.delete(ip); return false; } return f.n >= 8; }
function fail(ip) { const f = fails.get(ip); if (f && Date.now() - f.t <= 10 * 60e3) f.n++; else fails.set(ip, { n: 1, t: Date.now() }); }
const newId = () => Array.from(crypto.randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join('');

function createServer(store) {
  const listeners = new Map(); // id -> Set(res)
  const broadcast = id => { for (const res of listeners.get(id) || []) res.write('data: {"u":' + Date.now() + '}\n\n'); };
  const json = (res, code, obj) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); };
  const body = req => new Promise((ok, ko) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 20000) { ko(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { ko(e); } });
  });
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  async function api(req, res, url) {
    const parts = url.split('/').filter(Boolean); // ['api', ...]
    if (req.method === 'GET' && parts[1] === 'health') return json(res, 200, { ok: true, db: store.kind, version: VERSION, commit: COMMIT });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (req.method === 'POST' && parts[1] === 'login') {
      if (blocked(ip)) return json(res, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
      const b = await body(req);
      const ok = typeof b.user === 'string' && typeof b.pass === 'string' && same(b.user.trim().toLowerCase(), ADMIN_USER) && same(b.pass, ADMIN_PASS);
      if (!ok) { fail(ip); return json(res, 401, { error: 'Usuario o contraseña incorrectos' }); }
      fails.delete(ip); return json(res, 200, { token: mkToken() });
    }
    if (req.method === 'GET' && parts[1] === 'me') return json(res, 200, { admin: isAdmin(req) });
    const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
    const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
    if (req.method === 'GET' && parts[1] === 't' && parts.length === 2) return json(res, 200, { tournaments: await store.list() });
    if (req.method === 'POST' && parts[1] === 't' && parts.length === 2) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Solo el organizador puede crear torneos' });
      const b = await body(req), name = text(b.name, 80), date = text(b.date, 10), place = text(b.place, 80);
      if (!name) return json(res, 400, { error: 'Pon un nombre al torneo' });
      if (!validDate(date)) return json(res, 400, { error: 'Fecha inválida' });
      const id = newId();
      await store.create({ id, name, date, place, status: 'draft', n: 16, algo: 'mio', names: [], perm: [] }, 'admin');
      return json(res, 201, { id });
    }
    const id = parts[2];
    if (parts[1] !== 't' || !/^[a-z0-9]{6}$/.test(id || '')) return json(res, 404, { error: 'no encontrado' });
    if (req.method === 'GET' && parts.length === 3) {
      const t = await store.get(id); return t ? json(res, 200, t) : json(res, 404, { error: 'No existe ese torneo' });
    }
    if (req.method === 'GET' && parts[3] === 'events') {
      if (!(await store.get(id))) return json(res, 404, { error: 'No existe ese torneo' });
      res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write('retry: 3000\n\n');
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(res);
      const hb = setInterval(() => res.write(': hb\n\n'), 20000);
      req.on('close', () => { clearInterval(hb); const s = listeners.get(id); if (s) { s.delete(res); if (!s.size) listeners.delete(id); } });
      return;
    }
    if (req.method === 'PUT' && parts[3] === 'setup') {
      if (!isAdmin(req)) return json(res, 401, { error: 'Solo el organizador puede generar el cuadrante' });
      const t = await store.get(id); if (!t) return json(res, 404, { error: 'No existe ese torneo' });
      if (t.status !== 'draft') return json(res, 409, { error: 'El cuadrante ya está generado' });
      const b = await body(req), n = b.n, algo = b.algo === 'padel12' && n === 12 ? 'padel12' : 'mio';
      if (![8, 12, 16].includes(n)) return json(res, 400, { error: 'n inválido' });
      if (!Array.isArray(b.names) || b.names.length !== n || !b.names.every(x => typeof x === 'string' && x.length >= 1 && x.length <= 40)) return json(res, 400, { error: 'nombres inválidos' });
      if (!Array.isArray(b.perm) || b.perm.length !== n || [...b.perm].sort((x, y) => x - y).some((v, i) => v !== i)) return json(res, 400, { error: 'perm inválido' });
      await store.setup(id, { n, algo, names: b.names, perm: b.perm }); broadcast(id); return json(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && parts[3] === 'info') {
      if (!isAdmin(req)) return json(res, 401, { error: 'Solo el organizador puede editar' });
      const t = await store.get(id); if (!t) return json(res, 404, { error: 'No existe ese torneo' });
      const b = await body(req), name = text(b.name, 80), date = text(b.date, 10), place = text(b.place, 80);
      if (!name) return json(res, 400, { error: 'Pon un nombre al torneo' });
      if (!validDate(date)) return json(res, 400, { error: 'Fecha inválida' });
      await store.setInfo(id, { name, date, place }); broadcast(id); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && (parts[3] === 'finish' || parts[3] === 'reopen')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Solo el organizador puede hacer esto' });
      const t = await store.get(id); if (!t) return json(res, 404, { error: 'No existe ese torneo' });
      if (parts[3] === 'reopen') {
        if (t.status !== 'finished') return json(res, 409, { error: 'El torneo no está finalizado' });
        await store.setStatus(id, 'live', null); broadcast(id); return json(res, 200, { ok: true });
      }
      if (t.status !== 'live') return json(res, 409, { error: 'El torneo no está en juego' });
      const b = await body(req), st = b.standings;
      const okRow = r => r && typeof r.name === 'string' && r.name.length <= 40 && [r.pts, r.pj, r.w].every(v => isInt(v, 0, 999)) && isInt(r.dif, -999, 999);
      if (!Array.isArray(st) || st.length !== t.n || !st.every(okRow)) return json(res, 400, { error: 'clasificación inválida' });
      await store.setStatus(id, 'finished', st.map(r => ({ name: r.name, pts: r.pts, pj: r.pj, w: r.w, dif: r.dif })));
      broadcast(id); return json(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && parts[3] === 'results' && parts[4]) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Solo el organizador puede apuntar resultados' });
      const t = await store.get(id); if (!t) return json(res, 404, { error: 'No existe ese torneo' });
      if (t.status !== 'live') return json(res, 409, { error: t.status === 'finished' ? 'El torneo está finalizado' : 'El torneo aún no tiene cuadrante' });
      const m = /^(\d+)_(\d+)$/.exec(parts[4]);
      if (!m || +m[1] >= t.n - 1 || +m[2] >= t.n / 4) return json(res, 400, { error: 'partido inválido' });
      const b = await body(req);
      const clear = b.a === null && b.b === null;
      if (!clear && !(isInt(b.a, 0, 3) && isInt(b.b, 0, 3) && b.a + b.b <= 3)) return json(res, 400, { error: 'El partido se juega a 3 juegos: la suma no puede pasar de 3' });
      await store.setResult(id, parts[4], clear ? null : b.a, clear ? null : b.b);
      broadcast(id); return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return json(res, 401, { error: 'Solo el organizador puede hacer esto' });
      if (parts[3] === 'results') { const t = await store.get(id); if (!t || t.status !== 'live') return json(res, 409, { error: 'El torneo no está en juego' }); await store.clearResults(id); broadcast(id); return json(res, 200, { ok: true }); }
      if (parts.length === 3) { await store.remove(id); broadcast(id); return json(res, 200, { ok: true }); }
    }
    return json(res, 404, { error: 'no encontrado' });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/health') { res.writeHead(200); return res.end('ok'); }
      if (url.startsWith('/api/')) return await api(req, res, url);
      let p = url.endsWith('/') ? url + 'index.html' : url;
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('No encontrado'); }
        const ext = path.extname(file);
        res.writeHead(200, {'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'});
        res.end(data);
      });
    } catch (e) { if (!res.headersSent) json(res, 400, { error: 'petición inválida' }); else res.end(); }
  });
}

module.exports = { createServer };
if (require.main === module) {
  const store = createStore();
  store.init().then(async () => {
    try { await store.purgeDrafts(7); } catch (e) { /* limpieza opcional */ }
    const port = process.env.PORT || 3000;
    createServer(store).listen(port, '0.0.0.0', () => console.log('OctopadelApp v' + VERSION + (COMMIT ? ' (' + COMMIT + ')' : '') + ' en el puerto ' + port + ' (datos: ' + store.kind + ')'));
  }).catch(e => { console.error('No se pudo iniciar el almacén de datos:', e.message); process.exit(1); });
}
