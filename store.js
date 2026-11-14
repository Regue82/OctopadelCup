// Almacenes de datos: Postgres (Railway) o memoria (desarrollo local).
const crypto = require('crypto');
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const j = v => (typeof v === 'string' ? JSON.parse(v) : v);
const META = t => ({ id: t.id, name: t.name, date: t.date, place: t.place, status: t.status, n: t.n, algo: t.algo, names: t.names, perm: t.perm, standings: t.standings || null });

function memoryStore() {
  const T = new Map();
  return {
    kind: 'memory',
    async init() {},
    async create(t, ownerToken) { T.set(t.id, { ...t, owner: hash(ownerToken), res: {}, created: Date.now(), standings: null }); },
    async get(id) { const t = T.get(id); return t ? { ...META(t), res: { ...t.res } } : null; },
    async list() { return [...T.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created).slice(0, 300).map(t => ({ ...META(t), names: undefined, perm: undefined })); },
    async setup(id, { n, algo, names, perm }) { const t = T.get(id); Object.assign(t, { n, algo, names, perm, status: 'live' }); },
    async setInfo(id, { name, date, place }) { Object.assign(T.get(id), { name, date, place }); },
    async setStatus(id, status, standings) { const t = T.get(id); t.status = status; t.standings = standings || null; },
    async setResult(id, k, a, b) { const t = T.get(id); if (!t) return false; if (a === null && b === null) delete t.res[k]; else t.res[k] = [a, b]; return true; },
    async clearResults(id) { const t = T.get(id); if (t) t.res = {}; },
    async remove(id) { T.delete(id); },
    async purgeDrafts(days) { const lim = Date.now() - days * 864e5; for (const [id, t] of T) if (t.status === 'draft' && t.created < lim) T.delete(id); },
  };
}

function pgStore(pool) {
  const cols = 'id,name,date,place,status,n,algo,names,perm,standings';
  const row = r => ({ id: r.id, name: r.name || '', date: r.date || '', place: r.place || '', status: r.status || 'live', n: r.n, algo: r.algo, names: j(r.names), perm: j(r.perm), standings: r.standings ? j(r.standings) : null });
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS tournaments(
        id text PRIMARY KEY, n int NOT NULL, algo text NOT NULL, names jsonb NOT NULL, perm jsonb NOT NULL,
        owner text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        name text NOT NULL DEFAULT '', date text NOT NULL DEFAULT '', place text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'live', standings jsonb, finished_at timestamptz)`);
      // Migración para bases de datos creadas con versiones anteriores (no borra nada).
      for (const c of ["name text NOT NULL DEFAULT ''", "date text NOT NULL DEFAULT ''", "place text NOT NULL DEFAULT ''", "status text NOT NULL DEFAULT 'live'", 'standings jsonb', 'finished_at timestamptz']) {
        try { await pool.query('ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ' + c); } catch (e) { console.warn('migración:', e.message); }
      }
      await pool.query(`CREATE TABLE IF NOT EXISTS results(
        tid text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, k text NOT NULL,
        a int NOT NULL, b int NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tid, k))`);
    },
    async create(t, ownerToken) {
      await pool.query('INSERT INTO tournaments(id,name,date,place,status,n,algo,names,perm,owner) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [t.id, t.name, t.date, t.place, t.status, t.n, t.algo, JSON.stringify(t.names), JSON.stringify(t.perm), hash(ownerToken)]);
    },
    async get(id) {
      const r = await pool.query('SELECT ' + cols + ' FROM tournaments WHERE id=$1', [id]);
      if (!r.rows.length) return null;
      const rr = await pool.query('SELECT k,a,b FROM results WHERE tid=$1', [id]);
      const res = {}; rr.rows.forEach(x => { res[x.k] = [x.a, x.b]; });
      return { ...row(r.rows[0]), res };
    },
    async list() {
      const r = await pool.query('SELECT ' + cols + ' FROM tournaments ORDER BY date DESC, created_at DESC LIMIT 300');
      return r.rows.map(x => ({ ...row(x), names: undefined, perm: undefined }));
    },
    async setup(id, { n, algo, names, perm }) {
      await pool.query("UPDATE tournaments SET n=$2, algo=$3, names=$4, perm=$5, status='live' WHERE id=$1", [id, n, algo, JSON.stringify(names), JSON.stringify(perm)]);
    },
    async setInfo(id, { name, date, place }) { await pool.query('UPDATE tournaments SET name=$2, date=$3, place=$4 WHERE id=$1', [id, name, date, place]); },
    async setStatus(id, status, standings) {
      await pool.query('UPDATE tournaments SET status=$2, standings=$3 WHERE id=$1', [id, status, standings ? JSON.stringify(standings) : null]);
    },
    async setResult(id, k, a, b) {
      const e = await pool.query('SELECT 1 FROM tournaments WHERE id=$1', [id]);
      if (!e.rows.length) return false;
      if (a === null && b === null) await pool.query('DELETE FROM results WHERE tid=$1 AND k=$2', [id, k]);
      else await pool.query(`INSERT INTO results(tid,k,a,b) VALUES($1,$2,$3,$4)
        ON CONFLICT (tid,k) DO UPDATE SET a=EXCLUDED.a, b=EXCLUDED.b, updated_at=now()`, [id, k, a, b]);
      return true;
    },
    async clearResults(id) { await pool.query('DELETE FROM results WHERE tid=$1', [id]); },
    async remove(id) { await pool.query('DELETE FROM results WHERE tid=$1', [id]); await pool.query('DELETE FROM tournaments WHERE id=$1', [id]); },
    async purgeDrafts(days) { await pool.query(`DELETE FROM tournaments WHERE status='draft' AND created_at < now() - ($1 || ' days')::interval`, [String(days)]); },
  };
}

function createStore() {
  const url = process.env.DATABASE_URL;
  if (!url) return memoryStore();
  const { Pool } = require('pg');
  const internal = /\.railway\.internal/.test(url);
  return pgStore(new Pool({ connectionString: url, ssl: internal || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } }));
}
module.exports = { createStore, memoryStore, pgStore };
