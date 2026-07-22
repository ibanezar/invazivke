// Prenese proste fotografije vrst z Wikimedia Commons (naslovna slika
// članka na en.wikipedia) v public/img/species/ in v data/species.json
// zapiše pot, avtorja in licenco za pravilno navedbo.
// Uporaba: node scripts/fetch-photos.js
const fs = require('fs');
const path = require('path');

const SPECIES_FILE = path.join(__dirname, '..', 'data', 'species.json');
const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'species');
const WIDTH = 800;

const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ob omejitvi hitrosti (429) počakaj in poskusi znova
async function fetchRetry(url, tries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'invazivke-app/1.0 (izobrazevalni projekt)' } });
    if (res.status === 429 && i < tries) {
      await sleep(5000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} za ${url}`);
    return res;
  }
}

async function json(url) {
  return (await fetchRetry(url)).json();
}

async function leadImageFile(nameLat) {
  const data = await json(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(nameLat)}` +
      '&prop=pageimages&piprop=name&redirects=1&format=json'
  );
  const page = Object.values(data.query.pages)[0];
  return page && page.pageimage ? 'File:' + page.pageimage : null;
}

async function imageInfo(fileTitle) {
  const data = await json(
    'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo' +
      `&iiprop=url|extmetadata&iiurlwidth=${WIDTH}&format=json&titles=${encodeURIComponent(fileTitle)}`
  );
  const page = Object.values(data.query.pages)[0];
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  return {
    thumburl: info.thumburl || info.url,
    source: info.descriptionurl,
    author: stripHtml(meta.Artist && meta.Artist.value) || 'neznan avtor',
    license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value) || 'glej vir',
  };
}

(async () => {
  const species = JSON.parse(fs.readFileSync(SPECIES_FILE, 'utf8'));
  fs.mkdirSync(IMG_DIR, { recursive: true });
  let ok = 0;

  for (const s of species) {
    if (s.image && fs.existsSync(path.join(__dirname, '..', 'public', s.image))) {
      ok++;
      continue;
    }
    try {
      await sleep(2000);
      const file = await leadImageFile(s.name_lat);
      if (!file) throw new Error('članek nima naslovne slike');
      const info = await imageInfo(file);
      if (!info) throw new Error('ni podatkov o sliki');

      const res = await fetchRetry(info.thumburl);
      const ext = info.thumburl.match(/\.(png|webp)(\?|$)/i) ? RegExp.$1.toLowerCase() : 'jpg';
      const fileName = `${s.id}.${ext}`;
      fs.writeFileSync(path.join(IMG_DIR, fileName), Buffer.from(await res.arrayBuffer()));

      s.image = `/img/species/${fileName}`;
      s.image_author = info.author.slice(0, 120);
      s.image_license = info.license;
      s.image_source = info.source;
      ok++;
      console.log(`✔ ${s.name_sl} (${info.license}, ${s.image_author})`);
    } catch (err) {
      console.warn(`✘ ${s.name_sl}: ${err.message}`);
    }
  }

  fs.writeFileSync(SPECIES_FILE, JSON.stringify(species, null, 2) + '\n');
  console.log(`\nPrenesenih ${ok}/${species.length} fotografij.`);
})();
