# PassItOn IP-02 – installera prisförslag (alternativ B)

Det här paketet bygger **strukturerade, anonyma prisförslag utan fritext**. Det använder er befintliga Supabase Auth, era annonser och den befintliga **demo-kassan**. Ingen verklig betalning görs eller reserveras, och inga presentkortskoder levereras. Befintlig chatt under **dispyter efter köp** påverkas inte; det finns ingen chatt före köp.

## 1. Applicera patchen lokalt

Från PassitOn-repots rot, på en separat branch baserad på aktuell `main`:

```bash
git switch -c feature/ip-02-price-offers
git apply --check ~/Downloads/PassItOn_IP-02_price_offers.patch
git apply ~/Downloads/PassItOn_IP-02_price_offers.patch
node --test tests/price-offers.test.cjs
python3 -m http.server 8000
```

Öppna `http://localhost:8000/frontend/`. Om en arbetsbranch redan finns, kör `git switch <branch>` i stället för `git switch -c ...`.

**Viktigt:** SQL-migreringen krävs innan budknapparna fungerar. Gör inga commits förrän du själv har testat och granskat ändringarna. Startguiden använder Python-server eftersom nuvarande repo saknar ett npm-baserat frontend-bygge.

## 2. Kör migreringen i Supabase

1. Öppna Supabase Dashboard → ditt befintliga PassItOn-projekt.
2. Gå till **SQL Editor** → **New query**.
3. Kontrollera att ni redan har kört migrationsfilerna till och med:
   - `202610270001_listing_management.sql`
   - `202610270002_pause_pending_listing_reviews.sql`
4. Öppna och klistra in **hela innehållet** i:
   `backend/supabase/migrations/202610290001_price_offers.sql`
5. Kör **Run**. Migreringen skapar tabeller, säkerhetsregler och databasfunktioner i en transaktion. Om något fel uppstår rullas migreringen tillbaka.
6. Gå till **Database → Tables** och kontrollera att `public.price_offers` finns.
7. Kontrollera under **Database → Functions** att funktionerna `price_offer_create`, `price_offer_overview`, `price_offer_seller_action`, `price_offer_buyer_action`, `price_offer_is_reserved` och `demo_buy_accepted_offer` finns.

**Ingen ny API-nyckel behövs.** Frontend återanvänder `frontend/js/supabase-config.js` och `@supabase/supabase-js@2` som redan används för inloggning. Lägg aldrig in `service_role` eller Supabase-hemligheter i frontend.

### Supabase Auth och RLS

Endast inloggade användare får skapa och besvara bud. Frontend anropar kontrollerade RPC-funktioner med den befintliga Supabase-sessionen. Tabellerna med bud och privata alias har ingen direkt klientåtkomst. Alla regler (50 %, fem aktiva bud, ett aktivt per annons, behörighet, tidsfrister och spärr) kontrolleras i databasen; JS-kontrollerna är enbart för användarupplevelsen.

## 3. Testa med två verkliga testkonton

1. **Konto A:** publicera ett presentkort för exempelvis 700 kr och få annonsens fotobevis godkänt av admin. Bara publicerade och godkända annonser tar emot prisförslag.
2. **Konto B:** öppna annonsen och klicka **Lämna prisförslag**. Testa 350 kr (ska fungera), 349 kr (ska stoppas) och 700 kr (ska stoppas).
3. Skicka ett giltigt bud, exempelvis 500 kr. Se under **Mitt PassitOn → Skickade**.
4. **Konto A:** öppna **Mitt PassitOn → Mottagna**. Acceptera 500 kr, neka eller föreslå exempelvis 600 kr.
5. **Konto B:** efter accept visas **Till demo-kassan →** och 24 timmars betalningsfrist. Slutför en **demoorder** och kontrollera att köpet registreras med förhandlat pris.
6. Testa att en annan köpare **inte** kan skapa en demoorder för samma annons medan ett bud är accepterat och betalningsfristen fortfarande gäller.
7. Testa att köparen kan ha fem bud på fem olika annonser men inte ett sjätte; nekade/utgångna bud frigör plats.
8. Testa att användare som inte är inloggade skickas till kontosidan om de försöker pruta och sedan återvänder till annonsen vid inloggning.

## 4. Frister, varningar och missade betalningar

- Obesvarat bud: **24 timmar** från skapande; inget betalningsmiss registreras.
- Accepterat bud: **24 timmar** för köparen att genomföra demoköp. Under perioden blockeras andra köp av samma annons på databassidan.
- Missad betalning = accepterat bud vars betalningsfrist har gått ut utan genomfört köp.
- **Flera (2+) accepterade men ännu obetalda bud:** förebyggande varning på kontosidan direkt, även innan fristen löper ut.
- **1–4 missar senaste 30 dagarna:** varning på kontosidan.
- **5 missar senaste 30 dagarna:** nya prisförslag spärras i **7 dagar**. Vanliga köp och redan accepterade bud påverkas inte.
- Missar räknas via en privat logg (en per bud). De kan vid ett verkligt supportärende återkallas av databasadministratör genom `reversed_at`, men skapa inte själv en publik API-funktion för detta.

### Hur utgång hanteras

Den här MVP:n använder *lazy expiration*: när någon öppnar budöversikten eller skapar/besvarar ett bud uppdateras relevanta förfallna bud och eventuella missar. Tidsgränserna kontrolleras alltid i transaktionerna även om ingen har öppnat sidan, så utgångna bud kan **aldrig** köpas eller besvaras genom en gammal flik.

Om ni senare vill ha exakta push-/mejlnotiser vid 24 timmarsgränsen bör ni komplettera med en schemalagd serverfunktion (Supabase Cron), inte med en timer i webbläsaren.

## 5. Viktigt om betalning och vidareutveckling

- **Alternativ B** är implementerat som demo. Ingen kortbetalning, escrow, återbetalning eller utbetalning finns i det här paketet.
- `demo_buy_accepted_offer` skapar en Supabase-**demoorder** till det godkända budpriset och markerar annonsen som såld, under databaslås. Även den vanliga `demo_create_order` är skärpt så att samma annons inte kan köpas två gånger i demo.
- När en riktig betalningsleverantör är godkänd behöver köpsteget byggas om till betalningswebhook + transaktionell orderbekräftelse. **Låt inte demoorder-funktionen markera ett riktigt köp som betalt.** Reservationer, timeout och återgång vid misslyckad betalning måste då kopplas till betalningsleverantörens faktiska status.
- Endast SQL-kod i det här paketet ska köras i Supabase SQL Editor. CSS/JS körs automatiskt via frontend. Inga Edge Functions krävs för denna demo.
- Säljarspecifik avstängning av bud och automatiska e-postnotiser är möjliga senare förbättringar och ingår inte här.

## 6. Felsökning

| Symptom | Kontrollera |
| --- | --- |
| Prisförslag är inte tillgängliga | Kör IP-02 SQL-migreringen; kontrollera att annonsen har godkänt fotobevis. |
| Knappen visas inte | Den visas enbart på aktiva, godkända **Supabase-annonser**, inte på statiska demokort eller egna annonser. |
| Du har fem aktiva | Vänta på svar/utgång eller återkalla ett obesvarat bud via kontosidan. |
| Inloggning fungerar inte | Kontrollera `frontend/js/supabase-config.js`, URL och publishable/anon key samt att sidan körs via HTTP. |
| Demoköp fungerar inte | Kör alla äldre migreringar i ordning och sedan IP-02. Accepterade bud köps endast via knappen i prisförslagsöversikten. |
| Uteblivna betalningar visas inte direkt | Öppna Mitt PassitOn och tryck Uppdatera, så avslutas förfallna erbjudanden på servern. |
