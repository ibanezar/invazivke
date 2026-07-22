const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'invazivke-up-'));
process.env.DB_FILE = path.join(process.env.UPLOAD_DIR, 'test.db');
process.env.ADMIN_TOKEN = 'test-token';

const app = require('../server');
const db = require('../db');
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
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  server.close();
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

test('GET /api/stats vrne števce', async () => {
  const res = await fetch(base + '/api/stats');
  assert.strictEqual(res.status, 200);
  const stats = await res.json();
  assert.ok(stats.total >= 1);
  assert.ok(stats.by_species['japonski-dresnik'] >= 1);
  assert.ok(Object.keys(stats.by_month).length >= 1);
});

test('izvoz CSV vsebuje BOM, glavo in potrjena opazovanja', async () => {
  const res = await fetch(base + '/api/export.csv?status=vse');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const raw = Buffer.from(await res.arrayBuffer());
  // res.text() bi BOM odstranil, zato preverimo surove bajte
  assert.deepStrictEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  assert.match(text, /^id,znanstveno_ime,slovensko_ime/);
  assert.match(text, /Fallopia japonica/);
});

test('izvoz GeoJSON vrne veljavno FeatureCollection s koordinatami [lng, lat]', async () => {
  const res = await fetch(base + '/api/export.geojson?status=vse');
  assert.strictEqual(res.status, 200);
  const gj = await res.json();
  assert.strictEqual(gj.type, 'FeatureCollection');
  assert.ok(gj.features.length >= 1);
  const f = gj.features[0];
  assert.strictEqual(f.geometry.type, 'Point');
  assert.strictEqual(f.geometry.coordinates[0], 14.51);
  assert.strictEqual(f.geometry.coordinates[1], 46.05);
  assert.strictEqual(f.properties.scientificName, 'Fallopia japonica');
});

test('privzeti izvoz vsebuje samo potrjena opazovanja', async () => {
  const gj = await (await fetch(base + '/api/export.geojson')).json();
  assert.ok(gj.features.every((f) => f.properties.status === 'potrjeno'));
});

test('prijava skrbnika: napačni podatki 401, pravilni vrnejo sejni žeton', async () => {
  await db.createAdmin('ana', 'zeloVarnoGeslo1');

  const bad = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'napacno' }),
  });
  assert.strictEqual(bad.status, 401);

  const ok = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'zeloVarnoGeslo1' }),
  });
  assert.strictEqual(ok.status, 200);
  const { token, expires_at } = await ok.json();
  assert.ok(token && expires_at > new Date().toISOString());

  const check = await fetch(base + '/api/admin/check', { headers: { 'X-Admin-Token': token } });
  assert.strictEqual(check.status, 200);

  // odjava razveljavi sejo
  await fetch(base + '/api/admin/logout', { method: 'POST', headers: { 'X-Admin-Token': token } });
  const after = await fetch(base + '/api/admin/check', { headers: { 'X-Admin-Token': token } });
  assert.strictEqual(after.status, 401);
});

async function loginToken(username, password) {
  const res = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json()).token;
}

test('vloga pregledovalca sme brati, ne sme pa verificirati ali brisati', async () => {
  await db.createAdmin('bralec', 'zeloVarnoGeslo1', 'pregledovalec');
  const token = await loginToken('bralec', 'zeloVarnoGeslo1');

  const check = await fetch(base + '/api/admin/check', { headers: { 'X-Admin-Token': token } });
  assert.strictEqual((await check.json()).role, 'pregledovalec');

  // vidi kontakt (skrbniški pogled)
  const list = await (await fetch(base + '/api/observations', { headers: { 'X-Admin-Token': token } })).json();
  assert.ok(list.some((o) => 'contact' in o));

  // ne sme spremeniti statusa
  const patch = await fetch(base + `/api/observations/${list[0].id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: JSON.stringify({ status: 'potrjeno' }),
  });
  assert.strictEqual(patch.status, 403);

  // ne sme brisati
  const del = await fetch(base + `/api/observations/${list[0].id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': token },
  });
  assert.strictEqual(del.status, 403);
});

test('vloga urednika sme verificirati', async () => {
  await db.createAdmin('urednica', 'zeloVarnoGeslo2', 'urednik');
  const token = await loginToken('urednica', 'zeloVarnoGeslo2');
  const [obs] = await (await fetch(base + '/api/observations')).json();
  const patch = await fetch(base + `/api/observations/${obs.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: JSON.stringify({ status: 'vec-podatkov' }),
  });
  assert.strictEqual(patch.status, 200);
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
