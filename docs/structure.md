# Struktur och user stories

Underlag: det tidigare förslaget till krav och US01–US19. Tabellen visar ansvar och
nuvarande kodstatus; den ersätter inte kravdokumentets fullständiga acceptanskriterier.

| User stories | Frontend | Backend | Status |
| --- | --- | --- | --- |
| US01 Konto | features/account.js | routes/accounts.js, account-store.js, SQLite | Implementerad |
| US02 Identitetsverifiering | Verifieringsflöde läggs till vid implementation | routes/verification.js | Återstår |
| US03–US05 Lista, söka, filtrera/sortera | features/market.js | routes/listings.js | Frontenddemo finns |
| US06–US07 Detaljer och verifieringsinformation | features/product.js | routes/listings.js, routes/verification.js | Frontenddemo; ingen verklig verifiering |
| US08–US09 Köpa och få kod | features/product.js | routes/orders.js | Endast simulerat köp; kodleverans återstår |
| US10 Tidigare köp | features/dashboard.js | routes/orders.js | Lokal demohistorik |
| US11–US12 Annons och avgiftsberäkning | features/sell.js | routes/listings.js, routes/payments.js | Frontenddemo med 5 % avgift |
| US13–US14 Verifiering och annonsstatus | features/sell.js, features/dashboard.js | routes/verification.js, routes/listings.js | Verklig process återstår |
| US15 Ta bort annons (Could) | features/dashboard.js | routes/listings.js | Återstår |
| US16 Förstå tjänsten | index.html, befintliga informationsvyer | Inget eget serverområde | Informationsvyer finns |
| US17 Skydd mot dubbel försäljning | features/product.js | routes/orders.js och database/ | Återstår |
| US18–US19 Säker betalning och utbetalning | Köp- och säljarvyer | routes/payments.js, routes/orders.js och database/ | Återstår |

## Gemensam frontendkod

`app.js` startar och kopplar ihop funktionerna. `state.js` håller demotillstånd,
`storage.js` sparar demoköp och demoannonser, `utils.js` innehåller DOM- och
formateringshjälp, `ui.js` sköter navigation, meddelanden och köpindikatorn.
`data/cards.js` innehåller demopresentkort. CSS och HTML behåller nuvarande utseende.

US01 använder nu en kontovy, riktigt API-anrop och beständig SQLite-lagring. Övriga kontofunktioner som inloggning och identitetsverifiering återstår.
Dela vidare i controllers, services eller repositories först när verklig kod
behöver den ansvarsfördelningen. Konto och verifiering är kända krav, men får inte
låtsas vara klara genom att tomma frontendfiler läggs till.
