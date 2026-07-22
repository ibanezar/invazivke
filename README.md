# 🌿 Invazivke

Spletna aplikacija za sporočanje opazovanj invazivnih tujerodnih vrst v Sloveniji. Občani prijavijo opazovanje s fotografijo in GPS lokacijo, strokovnjaki pa prijave pregledajo in verificirajo.

## Funkcionalnosti

- **Katalog vrst** – 17 najpogostejših invazivnih vrst v Sloveniji (rastline, živali, glive) s **fotografijami**, opisi, podobnimi domačimi vrstami in vplivom na okolje; filtriranje po skupini in iskanje.
- **Prijava opazovanja** – zajem GPS lokacije telefona ali izbira točke na zemljevidu, obvezna fotografija (samodejno pomanjšanje slike na napravi pred nalaganjem), ocena količine, opomba in neobvezen kontakt.
- **Interaktivni zemljevid** – Leaflet + OpenStreetMap prikaz opazovanj po Sloveniji s filtri po vrsti, statusu in datumu. Privzeto so prikazana samo potrjena opazovanja.
- **Skrbniška plošča** – strokovnjak pregleda prijavo (fotografijo, lokacijo, opombo) in jo označi kot *Potrjeno*, *Zavrnjeno* ali *Potrebuje več podatkov*. Kontaktni podatki prijaviteljev so vidni samo skrbniku. Podpira vloge (urednik/pregledovalec).
- **Moje prijave** – prijave, oddane z naprave, s statusom verifikacije in odgovorom strokovnjaka (ID-ji v localStorage, brez registracije).
- **Statistika in izvoz** – pregled števila opazovanj po vrstah, statusih in mesecih; izvoz podatkov v CSV (Excel, z UTF-8 BOM) in GeoJSON (QGIS in druga GIS orodja) z znanstvenimi imeni za združljivost s strokovnimi bazami.
- **PWA / delo na terenu** – service worker predpomni aplikacijo in katalog vrst za offline uporabo; prijava, oddana brez signala, se shrani v čakalno vrsto (IndexedDB) in pošlje samodejno ob ponovni povezavi. Markerji na zemljevidu se pri večjem številu gručijo (Leaflet.markercluster).

## Zagon

```bash
npm install
npm start
```

Aplikacija teče na <http://localhost:3000>.

- Skrbniška plošča: <http://localhost:3000/admin.html>
- Skrbniški račun ustvariš z `npm run add-admin -- <ime> <geslo> [urednik|pregledovalec]`; prijava vrne sejni žeton (velja 12 ur, gesla so shranjena s scrypt). Vloga **urednik** (privzeta) sme verificirati in brisati, **pregledovalec** ima le vpogled (vključno s kontakti prijaviteljev).
- Dokler ni ustvarjen noben račun (prvi zagon), deluje zasilni statični žeton `ADMIN_TOKEN` (privzeto za razvoj: `invazivke-admin`); ko računi obstajajo, je veljaven le, če je `ADMIN_TOKEN` izrecno nastavljen v okolju.
- Vrata spremeniš s `PORT`.

Testi:

```bash
npm test
```

Za lokalni zagon je potreben **Node ≥ 22.5** (uporablja vgrajeni `node:sqlite`).

## Postavitev v splet (živa različica)

Aplikacija je Node/Express strežnik s SQLite bazo in nalaganjem slik, zato potrebuje gostitelja s **trajnim diskom** (ne serverless). Baza (`invazivke.db`) in naložene fotografije (`uploads/`) se shranjujejo na disk prek spremenljivk `DB_FILE` in `UPLOAD_DIR`.

### Render (najlažje – priporočeno)

1. Potisni repozitorij na GitHub (že narejeno).
2. Na <https://dashboard.render.com> izberi **New → Blueprint** in izberi ta repozitorij. Render prebere [`render.yaml`](render.yaml) in ustvari spletno storitev s 1 GB trajnim diskom (priklop na `/data`), regijo Frankfurt in naključnim `ADMIN_TOKEN`.
3. Po prvi postavitvi ustvari skrbniški račun prek Render **Shell**:
   ```bash
   npm run add-admin -- <ime> <geslo>
   ```
   ali se enkratno prijavi z zasilnim žetonom (vrednost `ADMIN_TOKEN` iz zavihka Environment).
4. Dobiš javni naslov oblike `https://invazivke.onrender.com`.

> Trajni disk je na Render na voljo od paketa **Starter** naprej (Free nima diska – tam bi se baza in slike ob vsaki postavitvi izgubile).

### Docker (Fly.io, Railway, VPS …)

V repozitoriju je [`Dockerfile`](Dockerfile). Priklopi volumen na `/data` za trajnost:

```bash
docker build -t invazivke .
docker run -p 3000:3000 -v invazivke-data:/data invazivke
```

Zdravstvena točka za nadzor gostitelja: `GET /healthz`.

## Arhitektura

| Sloj | Tehnologija |
|---|---|
| Frontend | Statični HTML/CSS/JS (brez build koraka), Leaflet.js + OpenStreetMap |
| Backend | Node.js + Express, Multer za nalaganje slik |
| Shramba | SQLite (vgrajeni `node:sqlite`, datoteka `data/invazivke.db`) + `uploads/` za slike |

Shramba je izolirana v `db.js`; ob prvem zagonu se morebitna stara JSON shramba (`data/observations.json`) samodejno migrira v SQLite. Pot do baze nastaviš z `DB_FILE`. Za večje namestitve je `db.js` edina datoteka, ki jo je treba prilagoditi za PostgreSQL + PostGIS.

### API

| Metoda | Pot | Opis |
|---|---|---|
| GET | `/api/species` | Katalog vrst (`?group=rastlina\|zival\|gliva`) |
| GET | `/api/observations` | Seznam opazovanj (`?species=&status=&from=&to=`); brez skrbniškega žetona so kontaktni podatki skriti |
| POST | `/api/observations` | Nova prijava (multipart: `species_id`, `lat`, `lng`, `photo`, `quantity`, `note`, `contact`) |
| GET | `/api/export.csv` | Izvoz CSV (`?status=potrjeno\|vse&species=`); privzeto samo potrjena |
| GET | `/api/export.geojson` | Izvoz GeoJSON FeatureCollection (isti filtri) |
| GET | `/api/stats` | Števci opazovanj po vrstah, statusih in mesecih |
| POST | `/api/admin/login` | Prijava skrbnika (`username`, `password`) → sejni žeton |
| POST | `/api/admin/logout` | Odjava (razveljavi sejni žeton) |
| PATCH | `/api/observations/:id/status` | Verifikacija (skrbnik; `status`, `status_note`) |
| DELETE | `/api/observations/:id` | Izbris prijave (skrbnik) |

Skrbniške zahteve pošljejo žeton v glavi `X-Admin-Token`.

## Fotografije vrst

Fotografije v katalogu so proste slike z Wikimedia Commons; ob vsaki je naveden avtor in licenca (vidno na kartici, povezava na izvor). Prenese jih skripta:

```bash
npm run fetch-photos
```

Skripta za vsako vrsto poišče naslovno sliko članka na Wikipediji, jo shrani v `public/img/species/` in v `data/species.json` zapiše `image`, `image_author`, `image_license` in `image_source`. Slike so pomanjšane na 800×600 za hitro nalaganje na terenu.

## Nadaljnji koraki

- PostgreSQL + PostGIS za večje namestitve.
- E-poštno obveščanje prijaviteljev ob spremembi statusa.
- Uskladitev izvoznih polj s standardom Darwin Core / [invazivke.si](https://www.invazivke.si) (Zavod za gozdove RS).
