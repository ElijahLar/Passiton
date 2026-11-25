# Patch 01 – presentkort och saldokontroll

## Driftsättning

1. Prova på ett separat Supabase-projekt med de tidigare migreringarna installerade. Använd befintlig adminregistrering enligt backend/README.md.
2. Kör hela `backend/supabase/migrations/202611250001_gift_card_verification.sql` som projektägare. Den behöver pgcrypto i schemat extensions och Supabase Cron (pg_cron). HMAC-nyckeln genereras en gång i den privata databasen. Bevara nyckeln tillsammans med databasen vid återställning.
3. Publicera frontend efter SQL-migreringen. I **Mitt PassItOn → Granska inkomna annonser → Företagsregister och granskningsregler** ska admin välja kandidat, fylla i officiell saldolänk, metod, kod- och PIN-regler och bekräfta digital inlösen innan aktivering. Registret börjar med kandidater. Aktivera bara de korttyper som företaget tillåter att ni kontrollerar. Dela inte inloggningar eller kortuppgifter i instruktionerna. Ange ett kodformat som särskiljer korttypen. Regel för borttagning av mellanslag eller bindestreck måste väljas innan en utfärdare har registrerade kort.
4. Kontrollera att jobbet `passiton-card-rechecks` är aktivt under Cron och att det befintliga Resend-jobbet kör. Kontrollperioden börjar på 30 dagar och kan justeras i granskningsvyn. Databasen kontrollerar säljbarhet vid varje försök. Kön och säljarens notis uppdateras inom nästa femminuterskörning.

## Befintliga annonser

Äldre godkända aktiva och pausade annonser behöver granskas igen. Öppna bud och reservationer annulleras vid migreringen, eftersom de avser kort utan den nya kontrollen. Slutförda order, dispyter och sålda poster behåller sina referenser. Kort som saknar foto eller PIN kan kompletteras genom att admin begär en ny inskickning. Säljaren skickar då in en ny annons med nytt foto och ny engångskod. Ett vanligt avslag registreras som historik. En uttryckligen spärrad kod får inte skickas in igen.

En kontroll på 5 000 kr eller mer och mindre än 30 dagar kvar är signaler till granskaren. En spärrad kod, en aktiv dubblett och avvikande saldo stoppar godkännandet. Granskningshistoriken skiljer mellan listing_review och pre_delivery. Endast listing_review används i demon.

## Testning

Kör `node --test tests/*.test.cjs`. Kör dessutom hela `tests/gift-card-verification.sql` som postgres i en migrerad testdatabas. SQL-testet använder tillfälliga konton och syntetiska kort i en transaktion som rullas tillbaka.

| Manuellt test | Förväntat resultat |
| --- | --- |
| Öppna formuläret utan aktiva företag. Aktivera sedan en testutfärdare, ladda om och välj företaget på mobil och dator. | Företaget visas i rätt kategori. PIN-fältet följer företagskonfigurationen. |
| Skicka in ett syntetiskt kort med fotobevis. Öppna marknaden i en utloggad webbläsare. | Annonsen är dold. Säljaren kan se den och får en inskickningsnotis. |
| Öppna granskningen med separat adminkonto. Visa fotot, jämför engångskoden, öppna kontrollsidan och hämta testuppgifterna. | Saldolänken innehåller inga kortuppgifter. Åtkomsten ger en rad i private.card_events. |
| Registrera fel saldo, prova sedan rätt saldo och alla sex kontroller. | Bara en fullständig godkänd kontroll publicerar annonsen. Produktsidan visar foto och datum för saldo separat. |
| Begär komplettering på ett annat kort. Läs motiveringen och skicka in nytt foto. Upprepa med spärrat kort. | Kompletteringen går till ny granskning. Spärrat kort nekas. |
| Acceptera ett bud och pausa utfärdaren. Prova att betala budet. | Köpet stoppas och reservationen annulleras utan betalningsmiss. |
| Kör en demoorder på en godkänd annons. Öppna orderhistorik och dispyt. | Orderflödet fungerar med demostatus. Köparen får varken kod eller PIN. |
| Slå på verifieringsmejl för ett testkonto och följ ett granskningsbeslut. | Notis och outboxpost finns. Bekräfta faktisk leverans med projektets Resend-konfiguration. |

## Kort PR-beskrivning

Utökar annonsformuläret och den befintliga granskningsvyn med företagsregister, privat PIN, loggad kodåtkomst, dubblettskydd och dokumenterad saldokontroll. Föråldrade kontroller stoppar köp och bud. Kör migreringen före frontend och aktivera verifierade utfärdare i administrationen.
