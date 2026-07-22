// Shramba v libSQL/SQLite: lokalno datoteka, v produkciji Turso (brezplačni oblak).
// Fotografije opazovanj so shranjene v bazi (tabela photos), zato aplikacija
// deluje tudi na gostiteljih brez trajnega diska (npr. Render free).
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

let url = (process.env.TURSO_DATABASE_URL || '').trim();
if (url) {
  // HTTP transport namesto websocketov: brez trajne povezave, ki bi ob
  // prekinitvi lahko sprožila neujeto napako in sesula proces
  url = url.replace(/^libsql:\/\//, 'https://').replace(/^wss:\/\//, 'https://');
  console.log('Shramba: Turso (' + url.replace(/\/\/([^.]{4})[^.]*/, '//$1…') + ')');
} else {
  const file = process.env.DB_FILE || path.join(__dirname, 'data', 'invazivke.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  url = 'file:' + file;
  console.log('Shramba: lokalna datoteka (' + file + ')');
}

const db = createClient({ url, authToken: (process.env.TURSO_AUTH_TOKEN || '').trim() || undefined });

const ready = (async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS observations (
      id          TEXT PRIMARY KEY,
      species_id  TEXT NOT NULL,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      quantity    TEXT,
      note        TEXT,
      contact     TEXT,
      photo       TEXT,
      status      TEXT NOT NULL DEFAULT 'neverificirano',
      status_note TEXT,
      created_at  TEXT NOT NULL,
      verified_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_obs_status ON observations(status)',
    'CREATE INDEX IF NOT EXISTS idx_obs_species ON observations(species_id)',
    `CREATE TABLE IF NOT EXISTS photos (
      id   TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BLOB NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS admins (
      id         TEXT PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE,
      pass_hash  TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'urednik',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      admin_id   TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    )`,
  ];
  for (const sql of stmts) await db.execute(sql);
})();

ready.catch((err) => {
  console.error('Baza ni dosegljiva ob zagonu:', err.message);
});

const rowToObj = (row) => (row ? { ...row } : null);

async function listObservations({ species, status, from, to } = {}, order = 'DESC') {
  await ready;
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (species) { where.push('species_id = ?'); args.push(species); }
  if (from) { where.push('created_at >= ?'); args.push(from); }
  if (to) { where.push('created_at <= ?'); args.push(to + 'T23:59:59'); }
  const sql =
    'SELECT * FROM observations' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ` ORDER BY created_at ${order === 'ASC' ? 'ASC' : 'DESC'}`;
  const res = await db.execute({ sql, args });
  return res.rows.map(rowToObj);
}

async function insertObservation(o) {
  await ready;
  await db.execute({
    sql: `INSERT INTO observations (id, species_id, lat, lng, quantity, note, contact, photo, status, status_note, created_at, verified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [o.id, o.species_id, o.lat, o.lng, o.quantity, o.note, o.contact, o.photo, o.status, o.status_note, o.created_at, o.verified_at],
  });
}

async function getObservation(id) {
  await ready;
  const res = await db.execute({ sql: 'SELECT * FROM observations WHERE id = ?', args: [id] });
  return rowToObj(res.rows[0]);
}

async function updateStatus(id, status, status_note) {
  await ready;
  const res = await db.execute({
    sql: 'UPDATE observations SET status = ?, status_note = ?, verified_at = ? WHERE id = ?',
    args: [status, status_note, new Date().toISOString(), id],
  });
  return res.rowsAffected ? getObservation(id) : null;
}

async function deleteObservation(id) {
  const obs = await getObservation(id);
  if (obs) {
    await db.execute({ sql: 'DELETE FROM observations WHERE id = ?', args: [id] });
    if (obs.photo) {
      const photoId = obs.photo.split('/').pop();
      await db.execute({ sql: 'DELETE FROM photos WHERE id = ?', args: [photoId] });
    }
  }
  return obs;
}

async function stats() {
  await ready;
  const count = async (sql) => {
    const res = await db.execute(sql);
    return Object.fromEntries(res.rows.map((r) => [r.k, Number(r.n)]));
  };
  const total = await db.execute('SELECT COUNT(*) AS n FROM observations');
  return {
    total: Number(total.rows[0].n),
    by_status: await count('SELECT status AS k, COUNT(*) AS n FROM observations GROUP BY status'),
    by_species: await count('SELECT species_id AS k, COUNT(*) AS n FROM observations GROUP BY species_id'),
    by_month: await count("SELECT substr(created_at, 1, 7) AS k, COUNT(*) AS n FROM observations GROUP BY k"),
  };
}

// --- fotografije (v bazi, da preživijo tudi brez trajnega diska) ---
async function savePhoto(id, mime, data) {
  await ready;
  await db.execute({ sql: 'INSERT INTO photos (id, mime, data) VALUES (?, ?, ?)', args: [id, mime, data] });
}

async function getPhoto(id) {
  await ready;
  const res = await db.execute({ sql: 'SELECT mime, data FROM photos WHERE id = ?', args: [id] });
  const row = res.rows[0];
  if (!row) return null;
  return { mime: row.mime, data: Buffer.from(row.data) };
}

// --- skrbniki in seje ---
const crypto = require('crypto');
const ROLES = ['urednik', 'pregledovalec'];
const SESSION_HOURS = 12;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 32).toString('hex');
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

async function createAdmin(username, password, role = 'urednik') {
  if (!ROLES.includes(role)) throw new Error('Neveljavna vloga (urednik ali pregledovalec).');
  await ready;
  await db.execute({
    sql: 'INSERT INTO admins (id, username, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [crypto.randomUUID(), username, hashPassword(password), role, new Date().toISOString()],
  });
}

async function findAdmin(username) {
  await ready;
  const res = await db.execute({ sql: 'SELECT * FROM admins WHERE username = ?', args: [username] });
  return rowToObj(res.rows[0]);
}

async function adminCount() {
  await ready;
  const res = await db.execute('SELECT COUNT(*) AS n FROM admins');
  return Number(res.rows[0].n);
}

async function createSession(adminId) {
  await ready;
  await db.execute({ sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [new Date().toISOString()] });
  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  await db.execute({ sql: 'INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)', args: [token, adminId, expires_at] });
  return { token, expires_at };
}

async function getSession(token) {
  if (!token) return null;
  await ready;
  const res = await db.execute({
    sql: `SELECT s.token, s.admin_id, s.expires_at, a.username, a.role
          FROM sessions s JOIN admins a ON a.id = s.admin_id
          WHERE s.token = ?`,
    args: [token],
  });
  const s = rowToObj(res.rows[0]);
  return s && s.expires_at > new Date().toISOString() ? s : null;
}

async function deleteSession(token) {
  await ready;
  await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
}

module.exports = {
  ready,
  listObservations, insertObservation, getObservation, updateStatus, deleteObservation, stats,
  savePhoto, getPhoto,
  createAdmin, findAdmin, adminCount, verifyPassword, createSession, getSession, deleteSession, ROLES,
};
