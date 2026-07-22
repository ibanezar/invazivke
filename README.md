# 🌿 Invazivke

Spletna aplikacija za sporočanje opazovanj invazivnih tujerodnih vrst v Sloveniji. Občani prijavijo opazovanje s fotografijo in GPS lokacijo, strokovnjaki pa prijave pregledajo in verificirajo.

## Funkcionalnosti

- **Katalog vrst** – 17 najpogostejših invazivnih vrst v Sloveniji (rastline, živali, glive) z opisi, podobnimi domačimi vrstami in vplivom na okolje; filtriranje po skupini in iskanje.
- **Prijava opazovanja** – zajem GPS lokacije telefona ali izbira točke na zemljevidu, obvezna fotografija (samodejno pomanjšanje slike na napravi pred nalaganjem), ocena količine, opomba in neobvezen kontakt.
- **Interaktivni zemljevid** – Leaflet + OpenStreetMap prikaz opazovanj po Sloveniji s filtri po vrsti, statusu in datumu. Privzeto so prikazana samo potrjena opazovanja.
- **Skrbniška plošča** – strokovnjak pregleda prijavo (fotografijo, lokacijo, opombo) in jo označi kot *Potrjeno*, *Zavrnjeno* ali *Potrebuje več podatkov*. Kontaktni podatki prijaviteljev so vidni samo skrbniku.
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
- Skrbniški žeton nastavi z okoljsko spremenljivko `ADMIN_TOKEN` (privzeto za razvoj: `invazivke-admin`).
- Vrata spremeniš s `PORT`.

Testi:

```bash
npm test
```

## Arhitektura

| Sloj | Tehnologija |
|---|---|
| Frontend | Statični HTML/CSS/JS (brez build koraka), Leaflet.js + OpenStreetMap |
| Backend | Node.js + Express, Multer za nalaganje slik |
| Shramba | JSON datoteka (`data/observations.json`) + `uploads/` za slike |

Shramba v JSON datoteki je namerna poenostavitev za MVP — API je zasnovan tako, da jo je enostavno zamenjati s PostgreSQL + PostGIS (funkciji `loadObservations`/`saveObservations` v `server.js`).

### API

| Metoda | Pot | Opis |
|---|---|---|
| GET | `/api/species` | Katalog vrst (`?group=rastlina\|zival\|gliva`) |
| GET | `/api/observations` | Seznam opazovanj (`?species=&status=&from=&to=`); brez skrbniškega žetona so kontaktni podatki skriti |
| POST | `/api/observations` | Nova prijava (multipart: `species_id`, `lat`, `lng`, `photo`, `quantity`, `note`, `contact`) |
| GET | `/api/export.csv` | Izvoz CSV (`?status=potrjeno\|vse&species=`); privzeto samo potrjena |
| GET | `/api/export.geojson` | Izvoz GeoJSON FeatureCollection (isti filtri) |
| GET | `/api/stats` | Števci opazovanj po vrstah, statusih in mesecih |
| PATCH | `/api/observations/:id/status` | Verifikacija (skrbnik; `status`, `status_note`) |
| DELETE | `/api/observations/:id` | Izbris prijave (skrbnik) |

Skrbniške zahteve pošljejo žeton v glavi `X-Admin-Token`.

## Nadaljnji koraki

- PostgreSQL + PostGIS namesto JSON shrambe; prava avtentikacija skrbnikov (več uporabnikov, vloge).
- E-poštno obveščanje prijaviteljev ob spremembi statusa.
- Uskladitev izvoznih polj s standardom Darwin Core / [invazivke.si](https://www.invazivke.si) (Zavod za gozdove RS).
