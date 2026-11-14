// Almacenes de datos: Postgres (Railway) o memoria (desarrollo local).
const crypto = require('crypto');
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function memoryStore() {
  const T = new Map();
  return {
    kind: 'memory',
    async init() {},
    async create(t, ownerToken) { T.set(t.id, { ...t, owner: hash(ownerToken), res: {}, created: Date.now() }); },
    async get(id) { const t = T.get(id); return t ? { id: t.id, n: t.n, algo: t.algo, names: t.names, perm: t.perm, res: { ...t.res } } : null; },
    async isOwner(id, token) { const t = T.get(id); return !!t && t.owner === hash(token); },
    async setResult(id, k, a, b) { const t = T.get(id); if (!t) return false; if (a === null && b === null) delete t.res[k]; else t.res[k] = [a, b]; return true; },
    async clearResults(id) { const t = T.get(id); if (t) t.res = {}; },
    async remove(id) { T.delete(id); },
    async purge(days) { const lim = Date.now() - days * 864e5; for (const [id, t] of T) if (t.created < lim) T.delete(id); },
  };
}

function pgStore(pool) {
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS tournaments(
        id text PRIMARY KEY, n int NOT NULL, algo text NOT NULL, names jsonb NOT NULL, perm jsonb NOT NULL,
        owner text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS results(
        tid text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, k text NOT NULL,
        a int NOT NULL, b int NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tid, k))`);
    },
    async create(t, ownerToken) {
      await pool.query('INSERT INTO tournaments(id,n,algo,names,perm,owner) VALUES($1,$2,$3,$4,$5,$6)',
        [t.id, t.n, t.algo, JSON.stringify(t.names), JSON.stringify(t.perm), hash(ownerToken)]);
    },
    async get(id) {
      const r = await pool.query('SELECT id,n,algo,names,perm FROM tournaments WHERE id=$1', [id]);
      if (!r.rows.length) return null;
      const row = r.rows[0];
      const rr = await pool.query('SELECT k,a,b FROM results WHERE tid=$1', [id]);
      const res = {}; rr.rows.forEach(x => { res[x.k] = [x.a, x.b]; });
      const j = v => (typeof v === 'string' ? JSON.parse(v) : v);
      return { id: row.id, n: row.n, algo: row.algo, names: j(row.names), perm: j(row.perm), res };
    },
    async isOwner(id, token) {
      const r = await pool.query('SELECT 1 FROM tournaments WHERE id=$1 AND owner=$2', [id, hash(token)]);
      return r.rows.length > 0;
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
    async purge(days) { await pool.query(`DELETE FROM tournaments WHERE created_at < now() - ($1 || ' days')::interval`, [String(days)]); },
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
