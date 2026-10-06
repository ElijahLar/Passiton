# Passiton MVP

En klickbar frontend-MVP för projektledningskursen.

## Starta

Öppna `frontend/index.html` direkt i webbläsaren, eller kör en enkel lokal webbserver från repots rot:

```bash
python -m http.server 8000
```

Öppna sedan `http://localhost:8000/frontend/`.
Rotens `index.html` skickar vidare till frontend och behåller query-parametrar och hash.

## Utvecklingsprincip

Passiton byggs stegvis utifrån projektets user stories. Vi undviker att skapa stora generiska frontend- och backendstrukturer för funktioner som ännu inte ska implementeras.

Varje user story dokumenteras i `docs/user-stories/` och får sedan de frontend-, backend- och testdelar som faktiskt behövs.

Aktuellt fokus:

- **US01 — Skapa konto**
- Krav-ID: **K01, K02, K03**
- Prioritet: **Must**

När US01 är klar går utvecklingen vidare till nästa user story.

## Struktur

```text
Passiton/
├── docs/
│   └── user-stories/        # User stories och spårbarhet till krav
├── frontend/
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── app.js
│       ├── data/
│       └── features/        # Funktioner läggs till när deras user story påbörjas
├── backend/
│   └── src/
│       └── features/        # Backendfunktioner läggs till story för story
└── index.html               # Vidarebefordran till frontend
```

### US01

För US01 ligger arbetet under:

- `docs/user-stories/US01-create-account.md`
- `frontend/js/features/account/`
- `backend/src/features/accounts/`

Kodmapparna använder domännamn som `account` och `accounts` i stället för user-story-ID:n. Det gör koden lättare att förstå samtidigt som dokumentationen behåller spårbarheten till US01 och K01–K03.

## Befintlig demo

Den nuvarande frontend-MVP:n innehåller bland annat:

- Marknadsplats med sök, kategorier, rabattfilter och sortering
- Produktdetaljsida
- Simulerat köp
- Säljflöde med 5 % transaktionsavgift och live-förhandsvisning
- Dashboard för köp och annonser
- Responsiv mobilvy
- Demo-data i `localStorage`

Detta är fortfarande demo-funktionalitet. Inga riktiga betalningar, presentkort, konton eller verifieringar hanteras ännu.
