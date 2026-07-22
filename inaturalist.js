// Povezava z iNaturalist: raziskovalno potrjena opazovanja naših vrst v
// Sloveniji. Rezultate predpomnimo v pomnilniku (osvežitev vsakih 6 ur),
// da smo prijazni do njihovega API-ja in se izognemo CORS v brskalniku.
const SLOVENIA_PLACE_ID = 8228;
const PER_SPECIES = 60;
const TTL_MS = 6 * 60 * 60 * 1000;
const UA = 'invazivke-app/1.0 (izobrazevalni projekt; sporocanje invazivnih vrst v Sloveniji)';

let cache = { at: 0, data: [] };
let inflight = null;

async function fetchSpecies(sp) {
  const url =
    'https://api.inaturalist.org/v1/observations' +
    `?taxon_name=${encodeURIComponent(sp.name_lat)}` +
    `&place_id=${SLOVENIA_PLACE_ID}` +
    '&quality_grade=research&geo=true&photos=true' +
    `&per_page=${PER_SPECIES}&order_by=observed_on&order=desc`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  const json = await res.json();
  return (json.results || [])
    .filter((o) => o.geojson && Array.isArray(o.geojson.coordinates))
    .map((o) => ({
      source: 'inaturalist',
      inat_id: o.id,
      species_id: sp.id,
      lat: o.geojson.coordinates[1],
      lng: o.geojson.coordinates[0],
      observed_on: o.observed_on || (o.observed_on_details && o.observed_on_details.date) || null,
      photo: (o.photos[0] && o.photos[0].url) ? o.photos[0].url.replace('/square.', '/small.') : null,
      uri: o.uri || `https://www.inaturalist.org/observations/${o.id}`,
      license: o.license_code || null,
    }));
}

async function refresh(speciesList) {
  const settled = await Promise.allSettled(speciesList.map(fetchSpecies));
  const data = [];
  for (const r of settled) if (r.status === 'fulfilled') data.push(...r.value);
  cache = { at: Date.now(), data };
  return data;
}

// vrne predpomnjene podatke; osveži v ozadju, ko potečejo
async function getObservations(speciesList) {
  const fresh = Date.now() - cache.at < TTL_MS;
  if (cache.at && fresh) return cache.data;

  if (!inflight) {
    inflight = refresh(speciesList).finally(() => { inflight = null; });
  }
  // ob prvem zagonu (prazen predpomnilnik) počakamo, sicer postrežemo staro
  if (!cache.at) return inflight;
  return cache.data;
}

module.exports = { getObservations };
