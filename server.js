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
const SPECIES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'species.json'), 'utf8'));
const db = require('./db');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  let list = db.listObservations(req.query);
  // javnost vidi vsa opazovanja s statusom; osebne podatke le skrbnik
  if (!isAdmin(req)) list = list.map(({ contact, ...pub }) => pub);
  res.json(list);
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

  db.insertObservation(obs);
  res.status(201).json({ id: obs.id, status: obs.status });
});

// --- API: izvoz podatkov (privzeto samo potrjena opazovanja) ---
function exportList(req) {
  const status = req.query.status || 'potrjeno';
  return db.listObservations(
    { status: status === 'vse' ? null : status, species: req.query.species },
    'ASC'
  );
}

const speciesMap = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

app.get('/api/export.csv', (req, res) => {
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? ''));
  const rows = [
    ['id', 'znanstveno_ime', 'slovensko_ime', 'skupina', 'lat', 'lng', 'datum_opazovanja', 'kolicina', 'opomba', 'status', 'datum_verifikacije'],
    ...exportList(req).map((o) => {
      const s = speciesMap[o.species_id] || {};
      return [o.id, s.name_lat, s.name_sl, s.group, o.lat, o.lng, o.created_at, o.quantity, o.note, o.status, o.verified_at];
    }),
  ];
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="invazivke-opazovanja.csv"');
  // BOM, da Excel pravilno prepozna UTF-8 (šumniki)
  res.send('\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n'));
});

app.get('/api/export.geojson', (req, res) => {
  const features = exportList(req).map((o) => {
    const s = speciesMap[o.species_id] || {};
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
      properties: {
        id: o.id,
        scientificName: s.name_lat,
        vernacularName: s.name_sl,
        group: s.group,
        eventDate: o.created_at,
        quantity: o.quantity,
        note: o.note,
        status: o.status,
        verifiedAt: o.verified_at,
      },
    };
  });
  res.type('application/geo+json');
  res.set('Content-Disposition', 'attachment; filename="invazivke-opazovanja.geojson"');
  res.json({ type: 'FeatureCollection', features });
});

// --- API: statistika ---
app.get('/api/stats', (req, res) => {
  res.json(db.stats());
});

// --- API: verifikacija (skrbnik) ---
app.patch('/api/observations/:id/status', requireAdmin, (req, res) => {
  const { status, status_note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Neveljaven status.' });

  const obs = db.updateStatus(req.params.id, status, (status_note || '').slice(0, 1000) || null);
  if (!obs) return res.status(404).json({ error: 'Opazovanje ne obstaja.' });
  res.json(obs);
});

app.delete('/api/observations/:id', requireAdmin, (req, res) => {
  const obs = db.deleteObservation(req.params.id);
  if (!obs) return res.status(404).json({ error: 'Opazovanje ne obstaja.' });
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
