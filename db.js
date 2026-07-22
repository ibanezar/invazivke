// Shramba opazovanj v SQLite (vgrajeni node:sqlite, brez zunanjih odvisnosti).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'invazivke.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS observations (
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
  );
  CREATE INDEX IF NOT EXISTS idx_obs_status ON observations(status);
  CREATE INDEX IF NOT EXISTS idx_obs_species ON observations(species_id);
  CREATE TABLE IF NOT EXISTS admins (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    pass_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    admin_id   TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
`);

// enkratna migracija iz stare JSON shrambe
const legacyFile = path.join(__dirname, 'data', 'observations.json');
if (!process.env.DB_FILE && fs.existsSync(legacyFile)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    const ins = db.prepare(
      `INSERT OR IGNORE INTO observations (id, species_id, lat, lng, quantity, note, contact, photo, status, status_note, created_at, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const o of legacy) {
      ins.run(o.id, o.species_id, o.lat, o.lng, o.quantity, o.note, o.contact, o.photo, o.status, o.status_note, o.created_at, o.verified_at);
    }
    fs.renameSync(legacyFile, legacyFile + '.migrated');
    if (legacy.length) console.log(`Migrirano ${legacy.length} opazovanj iz observations.json v SQLite.`);
  } catch (err) {
    console.error('Migracija observations.json ni uspela:', err.message);
  }
}

function listObservations({ species, status, from, to } = {}, order = 'DESC') {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (species) { where.push('species_id = ?'); params.push(species); }
  if (from) { where.push('created_at >= ?'); params.push(from); }
  if (to) { where.push('created_at <= ?'); params.push(to + 'T23:59:59'); }
  const sql =
    'SELECT * FROM observations' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ` ORDER BY created_at ${order === 'ASC' ? 'ASC' : 'DESC'}`;
  return db.prepare(sql).all(...params);
}

function insertObservation(o) {
  db.prepare(
    `INSERT INTO observations (id, species_id, lat, lng, quantity, note, contact, photo, status, status_note, created_at, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(o.id, o.species_id, o.lat, o.lng, o.quantity, o.note, o.contact, o.photo, o.status, o.status_note, o.created_at, o.verified_at);
}

function getObservation(id) {
  return db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
}

function updateStatus(id, status, status_note) {
  const res = db
    .prepare('UPDATE observations SET status = ?, status_note = ?, verified_at = ? WHERE id = ?')
    .run(status, status_note, new Date().toISOString(), id);
  return res.changes ? getObservation(id) : null;
}

function deleteObservation(id) {
  const obs = getObservation(id);
  if (obs) db.prepare('DELETE FROM observations WHERE id = ?').run(id);
  return obs;
}

function stats() {
  const count = (sql) => Object.fromEntries(db.prepare(sql).all().map((r) => [r.k, r.n]));
  return {
    total: db.prepare('SELECT COUNT(*) AS n FROM observations').get().n,
    by_status: count('SELECT status AS k, COUNT(*) AS n FROM observations GROUP BY status'),
    by_species: count('SELECT species_id AS k, COUNT(*) AS n FROM observations GROUP BY species_id'),
    by_month: count("SELECT substr(created_at, 1, 7) AS k, COUNT(*) AS n FROM observations GROUP BY k"),
  };
}

// --- skrbniki in seje ---
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 32).toString('hex');
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function createAdmin(username, password) {
  db.prepare('INSERT INTO admins (id, username, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(
    crypto.randomUUID(), username, hashPassword(password), new Date().toISOString()
  );
}

function findAdmin(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
}

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
}

const SESSION_HOURS = 12;

function createSession(adminId) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(token, adminId, expires_at);
  return { token, expires_at };
}

function getSession(token) {
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  return s && s.expires_at > new Date().toISOString() ? s : null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

module.exports = {
  listObservations, insertObservation, getObservation, updateStatus, deleteObservation, stats,
  createAdmin, findAdmin, adminCount, verifyPassword, createSession, getSession, deleteSession,
};
