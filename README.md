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

Za lokalni zagon je potreben **Node ≥ 18**; lokalno gre baza v datoteko `data/invazivke.db`, fotografije pa v isto bazo.

## Postavitev v splet — brezplačno (Render Free + Turso)

Vsi podatki (opazovanja, **fotografije**, skrbniki, seje) so v eni libSQL/SQLite bazi. V produkciji baza živi v **Turso** (brezplačni oblak, brez kartice), zato aplikacija ne potrebuje trajnega diska in teče na **Render Free**.

1. **Turso baza** — na <https://turso.tech> ustvari brezplačen račun (prijava z GitHubom) in novo bazo (regija `fra` – Frankfurt). Skopiraj:
   - *Database URL* (oblika `libsql://…turso.io`)
   - *Auth token* (gumb Create token)
2. **Render** — na <https://dashboard.render.com> izberi **New → Blueprint** in ta repozitorij. Render prebere [`render.yaml`](render.yaml); ob uvozu vpiši `TURSO_DATABASE_URL` in `TURSO_AUTH_TOKEN` iz 1. koraka.
3. Po ~2 minutah dobiš javni naslov oblike `https://invazivke.onrender.com`.
4. **Prvi skrbnik** — prijavi se na `/admin.html` z zasilnim žetonom (vrednost `ADMIN_TOKEN` v Render → Environment), nato čim prej ustvari pravi račun. Ker Render Free nima lupine, račun ustvariš lokalno proti isti bazi:
   ```bash
   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run add-admin -- <ime> <geslo>
   ```

> Render Free storitev po neaktivnosti zaspi; prvi obisk jo zbudi (\~30 s). Podatki so varni v Turso ne glede na to.

### Docker (Fly.io, Railway, VPS …)

V repozitoriju je [`Dockerfile`](Dockerfile). Brez Turso spremenljivk gre baza v lokalno datoteko — za trajnost priklopi volumen na `/data` ali nastavi `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`:

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
| Shramba | libSQL/SQLite (`@libsql/client`): lokalno datoteka, v produkciji Turso; fotografije opazovanj so v bazi (tabela `photos`) |

Shramba je izolirana v `db.js`. Lokalno pot do baze nastaviš z `DB_FILE`, produkcijsko bazo pa s `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`. Ker so fotografije v bazi, aplikacija ne potrebuje trajnega diska. Za večje namestitve je `db.js` edina datoteka, ki jo je treba prilagoditi za PostgreSQL + PostGIS.

### API

| Metoda | Pot | Opis |
|---|---|---|
| GET | `/api/species` | Katalog vrst (`?group=rastlina\|zival\|gliva`) |
| GET | `/api/observations` | Seznam opazovanj (`?species=&status=&from=&to=`); brez skrbniškega žetona so kontaktni podatki skriti |
| POST | `/api/observations` | Nova prijava (multipart: `species_id`, `lat`, `lng`, `photo`, `quantity`, `note`, `contact`) |
| GET | `/api/export.csv` | Izvoz CSV (`?status=potrjeno\|vse&species=`); privzeto samo potrjena |
| GET | `/api/export.geojson` | Izvoz GeoJSON FeatureCollection (isti filtri) |
| GET | `/api/stats` | Števci opazovanj po vrstah, statusih in mesecih |
| GET | `/photos/:id` | Fotografija opazovanja (strežena iz baze) |
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
