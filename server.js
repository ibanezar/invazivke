const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'invazivke-admin';

const DATA_DIR = path.join(__dirname, 'data');
const SPECIES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'species.json'), 'utf8'));
const db = require('./db');
const inaturalist = require('./inaturalist');

const STATUSES = ['neverificirano', 'potrjeno', 'zavrnjeno', 'vec-podatkov'];
const QUANTITIES = ['posamezen osebek', 'nekaj osebkov', 'večja skupina', 'obsežen sestoj'];

// meje Slovenije (grobo), da zavrnemo očitno napačne koordinate
const SI_BOUNDS = { latMin: 45.3, latMax: 46.95, lngMin: 13.3, lngMax: 16.7 };

// slike gredo v bazo, zato jih multer zadrži v pomnilniku
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Dovoljene so le slike JPEG, PNG ali WebP.'), ok);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ovoj za async handlerje, da napake pristanejo v error middleware
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function isAdmin(req) {
  const token = req.get('X-Admin-Token');
  if (!token) return false;
  if (await db.getSession(token)) return true;
  // zasilni statični žeton: dokler ni ustvarjen noben skrbnik (prvi zagon)
  // ali če je ADMIN_TOKEN izrecno nastavljen v okolju
  if (process.env.ADMIN_TOKEN || (await db.adminCount()) === 0) return token === ADMIN_TOKEN;
  return false;
}
const requireAdmin = aw(async (req, res, next) => {
  if (!(await isAdmin(req))) return res.status(401).json({ error: 'Neveljaven skrbniški žeton.' });
  next();
});

// vloga trenutnega skrbnika; zasilni statični žeton ima polne pravice (urednik)
async function adminRole(req) {
  const session = await db.getSession(req.get('X-Admin-Token'));
  return session ? session.role : 'urednik';
}
const requireEditor = aw(async (req, res, next) => {
  if (!(await isAdmin(req))) return res.status(401).json({ error: 'Neveljaven skrbniški žeton.' });
  if ((await adminRole(req)) !== 'urednik') {
    return res.status(403).json({ error: 'Za to dejanje je potrebna vloga urednika.' });
  }
  next();
});

// zdravstvena točka (za nadzor gostitelja)
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// --- API: katalog vrst ---
app.get('/api/species', (req, res) => {
  const { group } = req.query;
  res.json(group ? SPECIES.filter((s) => s.group === group) : SPECIES);
});

// --- fotografije opazovanj (iz baze) ---
app.get('/photos/:id', aw(async (req, res) => {
  const photo = await db.getPhoto(req.params.id);
  if (!photo) return res.status(404).end();
  res.type(photo.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(photo.data);
}));

// --- API: opazovanja ---
app.get('/api/observations', aw(async (req, res) => {
  let list = await db.listObservations(req.query);
  // javnost vidi vsa opazovanja s statusom; osebne podatke le skrbnik
  if (!(await isAdmin(req))) list = list.map(({ contact, ...pub }) => pub);
  res.json(list);
}));

app.post('/api/observations', upload.single('photo'), aw(async (req, res) => {
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

  const photoId = crypto.randomUUID();
  await db.savePhoto(photoId, req.file.mimetype, req.file.buffer);

  const obs = {
    id: crypto.randomUUID(),
    species_id,
    lat: latN,
    lng: lngN,
    quantity: quantity || null,
    note: (note || '').slice(0, 1000),
    contact: (contact || '').slice(0, 200),
    photo: '/photos/' + photoId,
    status: 'neverificirano',
    status_note: null,
    created_at: new Date().toISOString(),
    verified_at: null,
  };

  await db.insertObservation(obs);
  res.status(201).json({ id: obs.id, status: obs.status });
}));

// --- API: iNaturalist (raziskovalno potrjena opazovanja v Sloveniji) ---
app.get('/api/inaturalist', aw(async (req, res) => {
  let list = await inaturalist.getObservations(SPECIES);
  if (req.query.species) list = list.filter((o) => o.species_id === req.query.species);
  res.set('Cache-Control', 'public, max-age=1800');
  res.json(list);
}));

// --- API: izvoz podatkov (privzeto samo potrjena opazovanja) ---
// ?vir=vse doda tudi iNaturalist zapise (z označenim virom)
async function exportList(req) {
  const status = req.query.status || 'potrjeno';
  const local = (await db.listObservations(
    { status: status === 'vse' ? null : status, species: req.query.species },
    'ASC'
  )).map((o) => ({ ...o, source: 'invazivke' }));

  if (req.query.vir !== 'vse') return local;

  let inat = await inaturalist.getObservations(SPECIES);
  if (req.query.species) inat = inat.filter((o) => o.species_id === req.query.species);
  const inatRows = inat.map((o) => ({
    id: 'inat-' + o.inat_id,
    species_id: o.species_id,
    lat: o.lat,
    lng: o.lng,
    quantity: null,
    note: o.uri,
    status: 'potrjeno',
    created_at: o.observed_on || '',
    verified_at: null,
    source: 'inaturalist',
  }));
  return [...local, ...inatRows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

const speciesMap = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

app.get('/api/export.csv', aw(async (req, res) => {
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? ''));
  const rows = [
    ['id', 'znanstveno_ime', 'slovensko_ime', 'skupina', 'lat', 'lng', 'datum_opazovanja', 'kolicina', 'opomba', 'status', 'datum_verifikacije', 'vir'],
    ...(await exportList(req)).map((o) => {
      const s = speciesMap[o.species_id] || {};
      return [o.id, s.name_lat, s.name_sl, s.group, o.lat, o.lng, o.created_at, o.quantity, o.note, o.status, o.verified_at, o.source];
    }),
  ];
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="invazivke-opazovanja.csv"');
  // BOM, da Excel pravilno prepozna UTF-8 (šumniki)
  res.send('\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n'));
}));

app.get('/api/export.geojson', aw(async (req, res) => {
  const features = (await exportList(req)).map((o) => {
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
        source: o.source,
      },
    };
  });
  res.type('application/geo+json');
  res.set('Content-Disposition', 'attachment; filename="invazivke-opazovanja.geojson"');
  res.json({ type: 'FeatureCollection', features });
}));

// --- API: statistika ---
app.get('/api/stats', aw(async (req, res) => {
  res.json(await db.stats());
}));

// --- API: verifikacija (samo urednik) ---
app.patch('/api/observations/:id/status', requireEditor, aw(async (req, res) => {
  const { status, status_note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Neveljaven status.' });

  const obs = await db.updateStatus(req.params.id, status, (status_note || '').slice(0, 1000) || null);
  if (!obs) return res.status(404).json({ error: 'Opazovanje ne obstaja.' });
  res.json(obs);
}));

app.delete('/api/observations/:id', requireEditor, aw(async (req, res) => {
  const obs = await db.deleteObservation(req.params.id);
  if (!obs) return res.status(404).json({ error: 'Opazovanje ne obstaja.' });
  res.status(204).end();
}));

app.get('/api/admin/check', requireAdmin, aw(async (req, res) => res.json({ ok: true, role: await adminRole(req) })));

app.post('/api/admin/login', aw(async (req, res) => {
  const { username, password } = req.body || {};
  const admin = username && password ? await db.findAdmin(username) : null;
  if (!admin || !db.verifyPassword(password, admin.pass_hash)) {
    return res.status(401).json({ error: 'Napačno uporabniško ime ali geslo.' });
  }
  res.json(await db.createSession(admin.id));
}));

app.post('/api/admin/logout', aw(async (req, res) => {
  const token = req.get('X-Admin-Token');
  if (token) await db.deleteSession(token);
  res.json({ ok: true });
}));

// napake multerja in ostalo vrnemo kot JSON
app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Slika je prevelika (največ 8 MB).' : err.message;
  res.status(400).json({ error: msg });
});

// neujete napake (npr. iz ozadnjih povezav odjemalca baze) samo zabeležimo,
// namesto da bi sesule proces in povzročile zanko ponovnih zagonov
process.on('unhandledRejection', (err) => {
  console.error('Neujeta zavrnitev:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('Neujeta izjema:', err && err.stack ? err.stack : err);
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Invazivke tečejo na vratih ${PORT}`);
    // zasilni žeton izpišemo le v razvoju, ne v produkciji
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Skrbniška plošča: http://localhost:${PORT}/admin.html (zasilni žeton: ${ADMIN_TOKEN})`);
    }
  });
  db.ready
    .then(() => console.log('Baza pripravljena.'))
    .catch(() => {}); // napaka je že zabeležena v db.js
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = app;
