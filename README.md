# Passiton MVP

En klickbar frontend-MVP för projektledningskursen.

## Starta
För enbart demo-visning kan du öppna `frontend/index.html` direkt. För att använda kontoflödet med Supabase behöver sidan köras via en lokal webbserver från repots rot:

```bash
python -m http.server 8000
```

Öppna sedan `http://localhost:8000/frontend/`.
Rotens `index.html` skickar också vidare till frontend och behåller query-parametrar och hash.
Det gör att den befintliga GitHub Pages-adressen fortsätter fungera.

## Ingår
- Marknadsplats med sök, kategorier, rabattfilter och sortering
- Produktdetaljsida inspirerad av ren skandinavisk e-handel
- Demo-kassa med varukorg, testuppgifter, orderbekräftelse och lokal köphistorik
- Publicera presentkortsannonser med live-förhandsvisning och exempel på 5 % avgift
- Dashboard för köp och annonser
- Responsiv mobilvy
- Skapa konto och logga in med Supabase Auth (se [backend/README.md](backend/README.md) för konfiguration)
- Stripe Identity-verifiering för säljare i testläge
- Publicera annonser först efter godkänd identitetsverifiering (kräver Supabase-migrationer och Edge Functions; betalning är inte aktiverad)
- Demo-data lagras i `localStorage`

## Obs
Det här är en skol-MVP. Annonser och presentkortskoder sparas i Supabase, men koderna
verifieras inte och ingen riktig betalning eller överföring genomförs. Säljarens
identitet kan däremot verifieras med Stripe Identity i testläge. Demoorder
sparas bara i webbläsarens `localStorage`; testkortuppgifter sparas inte.

## Filstruktur

| Sökväg | Ansvar |
| --- | --- |
| `frontend/index.html` | Sidans HTML och vyer. |
| `frontend/css/styles.css` | Befintlig styling och mobilanpassning. |
| `frontend/js/app.js` | Navigation, rendering, filter, säljflöde och demoköp. |
| `frontend/js/data/cards.js` | Befintliga demopresentkort. Laddas före app.js. |
| `backend/README.md` | Supabase/Stripe-setup, migrationer och Edge Functions. |
| `backend/stripe-integration-plan.md` | Plan för Stripe Identity och framtida Connect/Payments. |
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
