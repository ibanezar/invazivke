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
