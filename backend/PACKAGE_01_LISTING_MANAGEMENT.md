# IP-01 – Annonshantering och granskning

**Bas:** `main` commit `2beeb13eaba067af2273f9b225f95829513a180f`.
**Branch:** `feature/ip-01-listing-management`. Ingen automatisk commit, push eller driftsättning.

## Syfte

Utöka den befintliga marknadsplatsen med verklig serverstyrd annonseringshantering, utan att aktivera betalning, presentkortsleverans eller Mangopay. Bevara Supabase som källa för annonser och användarkonton. Denna patch innehåller ingen Stripe-kod.

### Ingår

- Säljare kan ändra **pris**, pausa, återaktivera och permanent avpublicera sina egna annonser (soft delete).
- Värde, presentkortskod, varumärke och giltighet kan **inte** ändras utan ny annons med nytt fotobevis. Godkännande gäller endast manuellt fotograferat bevis, inte giltighet/saldo.
- Admin kan se väntande fotobevis i gränssnittet, läsa tillhörande engångskod, granska en **privat** bild och godkänna eller avslå (avslag kräver orsak).
- Samtliga ändringar går genom `SECURITY DEFINER`-RPC med användar- och rollkontroll på databassidan, validering av status och revisionslogg i privat schema.
- Egna annonser och granskningskö hämtas från Supabase. Pris/status är **inte** enbart lagrade i webbläsaren.
- Pausad och borttagen annons är inte synlig i publikt utbud. Ett utgånget kort kan inte godkännas eller återaktiveras. Befintliga demoorder behåller sina referenser.
- Annons med pågående demoorder kan inte ändras eller tas bort tills den är avslutad. I framtida Mangopay-flöde ska detta även skydda **riktiga reservationer och betalningar**; nuvarande demoorder gör inte det.

## Migrering och driftsättning

**Viktigt: Kör migreringen INNAN du publicerar den nya frontend-koden.** Säkerställ först att tidigare migreringar `202610060001`, `202610130001` och `202610130002` är applicerade i rätt Supabase-projekt.

1. Eftersom de tidigare migrationerna har körts i Supabase SQL Editor kan migrationshistoriken saknas i CLI. Använd därför **SQL Editor** för detta paket: klistra in och kör **hela** `backend/supabase/migrations/202610270001_listing_management.sql` med projektägarbehörighet. Från macOS terminal kan du kopiera texten med `cat backend/supabase/migrations/202610270001_listing_management.sql | pbcopy`. Använd **inte** `supabase db push` förrän migrationshistoriken har synkroniserats och verifierats.
2. Ladda om appen (hård omladdning). Logga in med säljare och kontrollera pris, pausa, återaktivera, ta bort.
3. Kör `node --test tests/listing-management.test.cjs` och `node --check frontend/js/listing-management.js` lokalt. Endast admin får granska. Ge adminrätt via tidigare dokumenterad `private.passiton_admins` i SQL Editor; registreringsformuläret ger aldrig administratörsbehörighet.
4. Testa med minst **två separata användarkonton och ett administratörskonto** före publicering.

**Ingen automatisk installation sker från en GitHub-branch.** SQL-migrationen utförs mot databasen först när du själv kör den.

## Säkerhetsverifiering innan riktiga användare

1. Säljare A ska kunna ändra priset på sin egen godkända annons; kontrollera samma pris i en separat webbläsare.
2. Säljare B ska få behörighetsfel om B anropar `manage_own_listing` på A:s UUID, även via RPC direkt.
3. Anonym och vanlig inloggad användare ska inte få läsa kön via `admin_listing_review_queue` eller skriva beslut via `admin_review_listing`.
4. Vanlig användare ska nekas signerad URL för annans privata fotobevis. Admin ska kunna se endast **inskickade** foton och får inte se privata presentkortskoder.
5. Avslagen annons ska inte visas publikt. Avslagsorsak visas för den berörda säljaren.
6. Pausad och borttagen annons ska försvinna ur marknadsplatsen, men finnas kvar för säljaren. Avlägsnade annonser ska inte gå att återaktivera.
7. En annons med `demo_orders.status='held'` ska inte kunna ändras/pausas/tas bort förrän ordern är avslutad.
8. Försök med negativa priser, pris >= kortets värde, ogiltig roll, ogiltigt statusbyte och dubbla samtidiga adminbeslut ska nekas av databasen.
9. Dokumentera manuell kvalitetskontroll av foton, retention/radering av bevis och GDPR innan extern lansering. Fotot **verifierar inte** presentkortets verkliga saldo eller äganderätt.
10. **Ingen riktig betalning, kodleverans eller utbetalning** får aktiveras utan en separat granskad Mangopay-integration.

## Befintliga begränsningar utanför IP-01

- Nuvarande demo-kassa ger ingen exklusiv reservation och kan tillåta flera demoorder på en annons. Bygg riktig reservations-/orderlogik i IP-02 innan betalningar aktiveras.
- `passiton-photo-proofs`-bucketen har ännu ingen retention-/rensningsjobb.
- Granskningen är **manuell**, inte en garanti för att presentkortet är oanvänt.
- Frontend innehåller fortfarande äldre demoannonser och demo-kassa. Märk detta tydligt vid verkliga användartester.
- Adminpanelen är en första intern funktion; bygg övervakning, incidentrutiner och robust driftsatt testsvit innan skarp kommersiell lansering.

## Ändringslogg

2026-10-27: IP-01 skapad mot `main`, ny migrering samt separata frontend-resurser för säljare/admin. Inte körd mot skarp Supabase. Branch skapad; ingen commit eller push gjord.


## IP-01B – Pausade ogranskade annonser (2026-10-27)

**Utgångspunkt:** `feature/ip-01-listing-management` commit
`c4e31db8d857a844a378a7634c4d0f1deee679e1`.
**Ny branch:** `feature/ip-01b-listing-polish`. Patch levereras utan commit/push.

1. På kontosidan tas den överflödiga Uppdatera-knappen bort.
2. En ogranskad annons kan pausas och återaktiveras. Under pausen syns
   den inte för administratören och kan inte godkännas eller avslås.
   Vid återaktivering kommer den tillbaka till granskningskön med samma
   tidigare uppladdade bevis (om annonsen inte är utgången).
3. Administratörssektionen får en luftig, mjukt tonad bakgrund i stället
   för en horisontell avdelare.
4. Ny inkrementell SQL-migrering måste köras **efter** IP-01:
   `backend/supabase/migrations/202610270002_pause_pending_listing_reviews.sql`.
   Kopiera **filens SQL-innehåll** via macOS-terminalen och klistra in i
   Supabase SQL Editor – klistra inte in terminalkommandot i SQL-editorn.

**Verifiering:** `node --check frontend/js/listing-management.js` och
`node --test tests/listing-management.test.cjs`; 9 lokala tester.
För produktion krävs fortfarande riktiga integrationstester mot Supabase
inklusive två säljarkonton och ett adminkonto. Ingen Mangopay, betalning
eller presentkortsleverans har aktiverats.
