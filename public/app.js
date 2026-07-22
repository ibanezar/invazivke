// Skupne pomožne funkcije za vse strani.

const STATUS_LABELS = {
  neverificirano: 'Neverificirano',
  potrjeno: 'Potrjeno',
  zavrnjeno: 'Zavrnjeno',
  'vec-podatkov': 'Potrebuje več podatkov',
};

const GROUP_LABELS = { rastlina: 'Rastlina', zival: 'Žival', gliva: 'Gliva' };

const SI_CENTER = [46.12, 14.82];

async function fetchSpecies() {
  const res = await fetch('/api/species');
  return res.json();
}

function speciesById(list) {
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

function badge(cls, label) {
  const span = document.createElement('span');
  span.className = 'badge ' + cls;
  span.textContent = label;
  return span;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('sl-SI', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Pomanjšanje slike na napravi pred nalaganjem (varčevanje s prenosom na terenu).
function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], 'foto.jpg', { type: 'image/jpeg' }) : file),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function showAlert(el, type, msg) {
  el.className = 'alert ' + type;
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// --- Moje prijave: ID-ji oddanih opazovanj v localStorage ---
const MY_KEY = 'invazivke-moje';

function rememberMyObservation(id) {
  const ids = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
  if (!ids.includes(id)) ids.push(id);
  localStorage.setItem(MY_KEY, JSON.stringify(ids));
}

function myObservationIds() {
  return JSON.parse(localStorage.getItem(MY_KEY) || '[]');
}

// --- Offline čakalna vrsta prijav (IndexedDB) ---
function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('invazivke-queue', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('queue', { keyPath: 'key', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function queueOp(mode, fn) {
  return openQueueDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('queue', mode);
        const req = fn(tx.objectStore('queue'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      })
  );
}

function queueAdd(record) {
  return queueOp('readwrite', (store) => store.add(record));
}
function queueAll() {
  return queueOp('readonly', (store) => store.getAll());
}
function queueDelete(key) {
  return queueOp('readwrite', (store) => store.delete(key));
}

// Poskusi poslati vse čakajoče prijave; vrne število uspešno poslanih.
async function flushQueue() {
  let sent = 0;
  const items = (await queueAll()) || [];
  for (const item of items) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(item.fields)) fd.set(k, v);
    fd.set('photo', item.photo, 'foto.jpg');
    try {
      const res = await fetch('/api/observations', { method: 'POST', body: fd });
      if (res.status >= 500) continue; // strežniška napaka: pusti v vrsti
      if (res.ok) {
        const body = await res.json();
        rememberMyObservation(body.id);
        sent++;
      }
      // 4xx (npr. neveljavni podatki) nima smisla ponavljati – odstrani
      await queueDelete(item.key);
    } catch {
      break; // še vedno brez povezave
    }
  }
  return sent;
}
