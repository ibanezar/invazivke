const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'invazivke-admin';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const OBS_FILE = path.join(DATA_DIR, 'observations.json');
const SPECIES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'species.json'), 'utf8'));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OBS_FILE)) fs.writeFileSync(OBS_FILE, '[]');

// --- preprosta shramba v JSON datoteki (za MVP; kasneje PostgreSQL + PostGIS) ---
function loadObservations() {
  return JSON.parse(fs.readFileSync(OBS_FILE, 'utf8'));
}
function saveObservations(list) {
  const tmp = OBS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, OBS_FILE);
}

const STATUSES = ['neverificirano', 'potrjeno', 'zavrnjeno', 'vec-podatkov'];
const QUANTITIES = ['posamezen osebek', 'nekaj osebkov', 'večja skupina', 'obsežen sestoj'];

// meje Slovenije (grobo), da zavrnemo očitno napačne koordinate
const SI_BOUNDS = { latMin: 45.3, latMax: 46.95, lngMin: 13.3, lngMax: 16.7 };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Dovoljene so le slike JPEG, PNG ali WebP.'), ok);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

function isAdmin(req) {
  return req.get('X-Admin-Token') === ADMIN_TOKEN;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Neveljaven skrbniški žeton.' });
  next();
}

// --- API: katalog vrst ---
app.get('/api/species', (req, res) => {
  const { group } = req.query;
  res.json(group ? SPECIES.filter((s) => s.group === group) : SPECIES);
});

// --- API: opazovanja ---
app.get('/api/observations', (req, res) => {
  let list = loadObservations();
  const admin = isAdmin(req);
  const { species, status, from, to } = req.query;

  // javnost privzeto vidi vsa opazovanja s statusom; osebne podatke le skrbnik
  if (status) list = list.filter((o) => o.status === status);
  if (species) list = list.filter((o) => o.species_id === species);
  if (from) list = list.filter((o) => o.created_at >= from);
  if (to) list = list.filter((o) => o.created_at <= to + 'T23:59:59');

  if (!admin) {
    list = list.map(({ contact, ...pub }) => pub);
  }
  res.json(list.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

app.post('/api/observations', upload.single('photo'), (req, res) => {
  const { species_id, lat, lng, quantity, note, contact } = req.body;

  const species = SPECIES.find((s) => s.id === species_id);
  if (!species) return res.status(400).json({ error: 'Neznana vrsta.' });

  const latN = parseFloat(lat);
  const lngN = parseFloat(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return res.status(400).json({ error: 'Manjka lokacija opazovanja.' });
  }
  if (latN < SI_BOUNDS.latMin || latN > SI_BOUNDS.latMax || lngN < SI_BOUNDS.lngMin || lngN > SI_BOUNDS.lngMax) {
    return res.status(400).json({ error: 'Lokacija je izven območja Slovenije.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Fotografija je obvezna za verifikacijo.' });
  if (quantity && !QUANTITIES.includes(quantity)) {
    return res.status(400).json({ error: 'Neveljavna ocena količine.' });
  }

  const obs = {
    id: crypto.randomUUID(),
    species_id,
    lat: latN,
    lng: lngN,
    quantity: quantity || null,
    note: (note || '').slice(0, 1000),
    contact: (contact || '').slice(0, 200),
    photo: '/uploads/' + req.file.filename,
    status: 'neverificirano',
    status_note: null,
    created_at: new Date().toISOString(),
    verified_at: null,
  };

  const list = loadObservations();
  list.push(obs);
  saveObservations(list);
  res.status(201).json({ id: obs.id, status: obs.status });
});

// --- API: verifikacija (skrbnik) ---
app.patch('/api/observations/:id/status', requireAdmin, (req, res) => {
  const { status, status_note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Neveljaven status.' });

  const list = loadObservations();
  const obs = list.find((o) => o.id === req.params.id);
  if (!obs) return res.status(404).json({ error: 'Opazovanje ne obstaja.' });

  obs.status = status;
  obs.status_note = (status_note || '').slice(0, 1000) || null;
  obs.verified_at = new Date().toISOString();
  saveObservations(list);
  res.json(obs);
});

app.delete('/api/observations/:id', requireAdmin, (req, res) => {
  const list = loadObservations();
  const idx = list.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Opazovanje ne obstaja.' });
  const [obs] = list.splice(idx, 1);
  saveObservations(list);
  if (obs.photo) fs.rm(path.join(UPLOAD_DIR, path.basename(obs.photo)), () => {});
  res.status(204).end();
});

app.get('/api/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

// napake multerja in ostalo vrnemo kot JSON
app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Slika je prevelika (največ 8 MB).' : err.message;
  res.status(400).json({ error: msg });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Invazivke tečejo na http://localhost:${PORT}`);
    console.log(`Skrbniška plošča: http://localhost:${PORT}/admin.html (žeton: ${ADMIN_TOKEN})`);
  });
}

module.exports = app;
