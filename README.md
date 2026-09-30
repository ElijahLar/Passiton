# Passiton MVP

En klickbar frontend-MVP för projektledningskursen.

## Starta
Öppna `frontend/index.html` direkt i webbläsaren, eller kör en enkel lokal webbserver från repots rot:

```bash
python -m http.server 8000
```

Öppna sedan `http://localhost:8000/frontend/`.
Rotens `index.html` skickar också vidare till frontend och behåller query-parametrar och hash.
Det gör att den befintliga GitHub Pages-adressen fortsätter fungera.

## Ingår
- Marknadsplats med sök, kategorier, rabattfilter och sortering
- Produktdetaljsida inspirerad av ren skandinavisk e-handel
- Simulerat köp
- Säljflöde med 5 % transaktionsavgift och live-förhandsvisning
- Dashboard för köp och annonser
- Responsiv mobilvy
- Demo-data lagras i `localStorage`

## Obs
Det här är en skol-MVP. Inga riktiga betalningar, presentkort eller verifieringar hanteras.

## Filstruktur

| Sökväg | Ansvar |
| --- | --- |
| `frontend/index.html` | Sidans HTML och vyer. |
| `frontend/css/styles.css` | Befintlig styling och mobilanpassning. |
| `frontend/js/app.js` | Navigation, rendering, filter, säljflöde och demoköp. |
| `frontend/js/data/cards.js` | Befintliga demopresentkort. Laddas före app.js. |
| `backend/README.md` | Backendens ansvar och nuvarande status. |
| `index.html` | Vidarebefordran från repots rot till frontend. |
| `patches/001-project-structure.patch` | Patchen för denna omstrukturering. |
| `scripts/apply_structure_patch.py` | Kontrollerar och applicerar patchen. |

## Applicera strukturpatchen

Kräver Python 3 och Git. Från repots rot:

```bash
python3 scripts/apply_structure_patch.py --check
python3 scripts/apply_structure_patch.py
```

Scriptet kontrollerar först att hela patchen går att applicera. Vid konflikt
avbryter det utan att applicera patchen. Det skapar ingen commit och gör ingen push.
Efter applicering kan du granska ändringarna med `git diff` och göra en egen commit.
Patchen är skapad mot commit `a7fb446344c2a9048331c46a30f78b8b34720ccc`.
