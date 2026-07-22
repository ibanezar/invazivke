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

// --- ikone (inline SVG, stroke 2, 24x24) ---
const ICONS = {
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  leaf: '<path d="M12 3c5 3 7 8 4 13-2 3-6 4-9 2C4 15 5 8 12 3Z"/><path d="M7 18c2-4 4-7 8-10"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  pin: '<path d="M12 21s-7-5.7-7-11a7 7 0 0 1 14 0c0 5.3-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M4 20h17"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M4 21h16"/>',
};

function icon(name, size = 18) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ikone v glavni navigaciji (glede na cilj povezave)
const NAV_ICONS = {
  '/': 'map',
  '/katalog.html': 'leaf',
  '/prijava.html': 'camera',
  '/moje.html': 'pin',
  '/stats.html': 'chart',
  '/admin.html': 'shield',
};
document.addEventListener('DOMContentLoaded', () => {
  for (const a of document.querySelectorAll('header nav a')) {
    const name = NAV_ICONS[a.getAttribute('href')];
    if (name) a.insertAdjacentHTML('afterbegin', icon(name, 16));
  }
});

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
