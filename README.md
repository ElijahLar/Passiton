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

### Separat PayPal-sandboxtest

På branchen `feature/paypal-sandbox` finns en separat testsida:
`http://localhost:8000/frontend/paypal-sandbox.html`.
Den provar en fast betalning på 10,00 SEK i låtsaspengar via plattformsappen till en ansluten sandbox-säljare;
den befintliga demokassan och annonserna används inte av testet.
Supabase-funktionen och den nya tabellen behöver installeras separat.
Se [installationsguiden](docs/PAYPAL_SANDBOX_SETUP.md).

### Befintliga funktioner

- Marknadsplats med sök, kategorier, rabattfilter och sortering
- Produktdetaljsida inspirerad av ren skandinavisk e-handel
- Demo-kassa med varukorg, testuppgifter, orderbekräftelse och lokal köphistorik
- Supabase-demoorder för granskade säljarannonser (inloggad köpare), med 48-timmars kontrolltid
- Privat köpar-/säljarchatt, bildbevis, eskalering till admin och simulerade beslut i dispyter
- Publicera presentkortsannonser med live-förhandsvisning och exempel på 5 % avgift
- Dashboard för köp och annonser
- Responsiv mobilvy
- Skapa konto och logga in med Supabase Auth (se [backend/README.md](backend/README.md) för konfiguration)
- Skicka annonser för manuell granskning med en servergenererad 30-minuters kod och privat fotobevis (kräver båda Supabase-migreringarna; betalning är inte aktiverad)
- Demo-data lagras i `localStorage`

## Obs
Det här är en skol-MVP. Säljaren kan skapa en **30-minuters engångskod**, skriva den
på papper, fotografera koden med saldo och datum/klockslag och ladda upp bilden
privat. Listan är **väntande** tills projektägaren manuellt har granskat bilden;
ingen automatisk kort- eller saldovalidering görs. Presentkortskoden sparas
separat i Supabase. Ingen riktig betalning eller överföring genomförs. Demoorder
sparas bara i webbläsarens `localStorage`; testkortuppgifter sparas inte.

**Aktivering:** Kör SQL-migreringarna i ordning:
`202610060001_create_gift_card_listings.sql`,
`202610130001_add_listing_photo_proof.sql` och
`202610130002_add_demo_disputes.sql`.
Se [backend/README.md](backend/README.md) för att lägga till administratör,
testa med två konton och granska privata dispyter.
**Inga riktiga pengar hålls, skickas eller återbetalas; det här är en simulering.**

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

## Statistik och cookiehantering

GTM-containern är integrerad i webbplatskoden och consent-standardvärden är satta till `denied` för frivillig statistik/annonsering. Cookiebanner och taggar måste fortfarande konfigureras **i GTM och en CMP** innan GA4 aktiveras. Se [guiden för GA4, GTM och Cookiebot](docs/analytics-gtm.md). Demoorder ska inte rapporteras som riktig omsättning.

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

