# Passiton MVP

Passiton är ett skolprojekt och en marknadsplats för att köpa och sälja presentkort.

## Förutsättningar

- Node.js 22.5 eller senare (backend använder inbyggda `node:sqlite`)
- npm
- Python 3 endast om du vill använda patch-scriptet

## Starta backend

```bash
cd backend
npm install
npm start
```

Backend kör på `http://127.0.0.1:3000` och skapar SQLite-databasen
`backend/database/passiton.sqlite` automatiskt.

## Starta frontend

I en separat terminal:

```bash
cd frontend
npm install
npm run dev
```

Öppna `http://127.0.0.1:5173`. Frontendens devserver proxar `/api` till backend
på port 3000. Ingen frontendramverk har införts; befintlig HTML/CSS/JavaScript används.

## US01

Registreringsvyn skickar ett riktigt API-anrop till `POST /api/accounts/register`.
E-post och lösenord valideras i både frontend och backend. Konton sparas beständigt
i SQLite och lösenord hashas med scrypt. Inloggning och identitetsverifiering ingår
inte i US01.

Övriga köp- och säljfunktioner är fortfarande skol-MVP/demo där tidigare beteende
med `localStorage` används.

## Struktur

- `frontend/`: HTML, CSS, JavaScript och lokal devserver.
- `backend/`: Node-server, API-routes och SQLite-lagring.
- `docs/structure.md`: koppling mellan struktur och user stories.
- `patches/`: numrerade ändringspatchar.
- `scripts/patch-00.py`: återanvändbart script för valfri patch i `patches/`.

## Applicera patch 01

Patch 00a ska vara applicerad först.

```bash
python3 scripts/patch-00.py 01 --check
python3 scripts/patch-00.py 01
```

Scriptet skapar ingen commit och gör ingen push.
