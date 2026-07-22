const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'invazivke-up-'));
process.env.ADMIN_TOKEN = 'test-token';

const OBS_FILE = path.join(__dirname, '..', 'data', 'observations.json');
let obsBackup = null;

const app = require('../server');
let server, base;

// 1x1 px JPEG
const TINY_JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

function postObservation(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('photo', new Blob([TINY_JPG], { type: 'image/jpeg' }), 'foto.jpg');
  return fetch(base + '/api/observations', { method: 'POST', body: fd });
}

before(async () => {
  obsBackup = fs.existsSync(OBS_FILE) ? fs.readFileSync(OBS_FILE, 'utf8') : null;
  fs.writeFileSync(OBS_FILE, '[]');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  server.close();
  if (obsBackup !== null) fs.writeFileSync(OBS_FILE, obsBackup);
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});

test('GET /api/species vrne katalog', async () => {
  const res = await fetch(base + '/api/species');
  assert.strictEqual(res.status, 200);
  const list = await res.json();
  assert.ok(list.length >= 15);
  assert.ok(list.every((s) => s.id && s.name_sl && s.name_lat && s.group));
});

test('GET /api/species?group=zival filtrira po skupini', async () => {
  const res = await fetch(base + '/api/species?group=zival');
  const list = await res.json();
  assert.ok(list.length > 0);
  assert.ok(list.every((s) => s.group === 'zival'));
});

test('POST /api/observations ustvari opazovanje', async () => {
  const res = await postObservation({
    species_id: 'japonski-dresnik',
    lat: '46.05',
    lng: '14.51',
    quantity: 'obsežen sestoj',
    note: 'Ob Ljubljanici',
    contact: 'test@example.com',
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.ok(body.id);
  assert.strictEqual(body.status, 'neverificirano');
});

test('POST zavrne lokacijo izven Slovenije', async () => {
  const res = await postObservation({ species_id: 'nutrija', lat: '48.2', lng: '16.4' });
  assert.strictEqual(res.status, 400);
});

test('POST zavrne neznano vrsto', async () => {
  const res = await postObservation({ species_id: 'zmaj', lat: '46.05', lng: '14.51' });
  assert.strictEqual(res.status, 400);
});

test('javni seznam skrije kontakt, skrbniški ga vrne', async () => {
  const pub = await (await fetch(base + '/api/observations')).json();
  assert.ok(pub.length >= 1);
  assert.ok(pub.every((o) => !('contact' in o)));

  const adm = await (
    await fetch(base + '/api/observations', { headers: { 'X-Admin-Token': 'test-token' } })
  ).json();
  assert.ok(adm.some((o) => o.contact === 'test@example.com'));
});

test('verifikacija zahteva žeton in spremeni status', async () => {
  const [obs] = await (await fetch(base + '/api/observations')).json();

  const noAuth = await fetch(base + `/api/observations/${obs.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'potrjeno' }),
  });
  assert.strictEqual(noAuth.status, 401);

  const ok = await fetch(base + `/api/observations/${obs.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-token' },
    body: JSON.stringify({ status: 'potrjeno' }),
  });
  assert.strictEqual(ok.status, 200);
  const updated = await ok.json();
  assert.strictEqual(updated.status, 'potrjeno');
  assert.ok(updated.verified_at);

  const confirmed = await (await fetch(base + '/api/observations?status=potrjeno')).json();
  assert.ok(confirmed.some((o) => o.id === obs.id));
});
