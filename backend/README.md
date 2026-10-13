# Backend

## Konton

Passiton använder Supabase Auth för att skapa konton och logga in med e-post och
lösenord. Supabase hanterar lösenord, sessioner och användaridentiteter. Namnet
från registreringen sparas som `full_name` i användarens metadata.

Auth-klienten körs i frontend eftersom projektet är en statisk HTML/CSS/JS-app;
en egen server behövs inte för registrering och inloggning. Klienten använder
endast Supabase Project URL och en publishable key (eller äldre anon key). Lägg
aldrig en `service_role`-nyckel i frontend.

### Koppla Supabase-projektet

1. Skapa eller välj ett projekt i Supabase.
2. Kopiera projektets URL och publishable key från Connect/API-inställningarna
   till `frontend/js/supabase-config.js`.
3. I Authentication → URL Configuration lägger du till appens URL under
   Redirect URLs. För README:ns lokala server är den
   `http://localhost:8000/frontend/`. Lägg också till den URL som används vid
   driftsättning.
4. E-postbekräftelse är aktiverad som standard för hostade Supabase-projekt.
   När den är på visas en instruktion om att bekräfta adressen innan inloggning;
   om den är avstängd loggas användaren in direkt efter registrering.

Starta appen via HTTP enligt instruktionerna i repots `README.md`; autentisering
fungerar inte när `frontend/index.html` öppnas direkt som en `file://`-fil.

## Publicera annonser

Kör `backend/supabase/migrations/202610060001_create_gift_card_listings.sql` en
gång i Supabase Dashboard → SQL Editor. Ladda sedan om appen så att den hämtar
den nya databasschemat. Migreringen skapar:

- `public.gift_card_listings`, vars aktiva annonser kan läsas av besökare.
- `private.gift_card_secrets`, där presentkortskoder lagras utan direkt åtkomst
  från klientrollerna.
- `public.create_gift_card_listing`, en autentiserad databasfunktion som skapar
  annonsen och den privata koden atomiskt. Säljaren får inte direkt skriva till
  annonstabellen eller läsa hemlighetstabellen.

Efter migreringen kan en inloggad användare publicera en annons. Annonsen visas
i marknadsplatsen och på säljarens konto. Publika annonser märks som
overifierade; säljarens fullständiga namn och presentkortskoden visas inte.

## Kostnadsfritt fotobevis med engångskod (30 minuter)

MVP-flödet använder Supabase Auth + Postgres + **privat** Supabase Storage,
utan Stripe Identity eller en betald identitetsleverantör. Fotobeviset styrker
högst att säljaren har kunnat fotografera ett saldo tillsammans med en färsk kod.
Det verifierar **inte** vem säljaren är, äganderätt, verkligt saldo, kortets
giltighet eller att koden inte löses in senare.

### Installera

Kör SQL-filerna i ordning i **Supabase Dashboard → SQL Editor**:

1. `backend/supabase/migrations/202610060001_create_gift_card_listings.sql`
   (endast om den inte redan körts).
2. `backend/supabase/migrations/202610130001_add_listing_photo_proof.sql`

Den andra migreringen skapar en privat bucket `passiton-photo-proofs` (max 5 MB
per JPG/PNG/WebP), en utmaningstabell, ett skyddat RPC-anrop för engångskod
och en ny listnings-RPC som kräver en uppladdad bild från samma inloggade säljare.
Den gamla RPC-signaturen tas bort så att bildkravet inte kan kringgås.

**Viktigt:** Driftsätt migreringen innan du använder frontend från denna branch.
Migreringen ändrar också läsrättigheterna för äldre annonser: befintliga
annonser markeras `pending` tills en granskare har kontrollerat dem.
Publicera därför inte feature-branchen på GitHub Pages innan SQL är installerat.
SQL-filen är avsiktligt inte körd automatiskt från GitHub.

### Säljarflöde

1. Logga in, fyll i varumärke, saldo, pris och privat presentkortskod.
2. Klicka på **Generera kod – 30 minuter**. Supabase skapar en slumpad
   `PASS-XXXXXXXXXXXX`-kod med exakt 30 minuters serverstyrd giltighet.
3. Skriv koden på **papper** och fotografera den i samma nya bild som
   återstående saldo och aktuellt datum/klockslag. Dölj alla inlösningskoder,
   PIN-koder och hela kortnummer.
4. Välj fotot och **Skicka annons för granskning** innan koden går ut.
   Bilder som saknas, är för stora, hör till en annan användare/utmaning
   eller laddats upp utanför perioden avvisas av servern.
5. Resultatet blir `photo_review_status = pending`. Annonsen syns i
   säljarens dashboard men **inte** i det publika utbudet.
6. En admin granskar bilden och antingen godkänner eller avslår annonsen.

Varje ny kod ogiltigförklarar föregående kod. Att skicka samma kod två gånger
misslyckas. En klientkontroll är bara en hjälp för användaren; den riktiga
kontrollen sker i Postgres.

### Manuell granskning (projektägare)

Öppna `Storage → passiton-photo-proofs` i Supabase Dashboard. Inga proof-foton
ligger i en publik bucket. Hämta information om väntande foton i SQL Editor:

```sql
select l.id, l.brand, l.value, l.price, l.created_at,
       p.photo_path, c.proof_code, c.created_at as challenge_created_at,
       c.expires_at as challenge_expires_at
from public.gift_card_listings l
join private.listing_photo_submissions p on p.listing_id = l.id
join private.listing_photo_challenges c on c.id = p.challenge_id
where l.photo_review_status = 'pending'
order by l.created_at;
```

En person måste kontrollera att fotot faktiskt visar **samma kod**,
saldo och datum/klockslag, utan att presentkortets hemliga inlösningskod
exponeras. För godkännande, i **SQL Editor med projektägarbehörighet**:

```sql
update public.gift_card_listings
set photo_review_status = 'approved'
where id = '<LISTING_UUID>' and photo_review_status = 'pending';
```

Byt till `'rejected'` om bilden saknar bevis eller är manipulerad.
Frontend och RLS visar endast godkända annonser publikt. Säljaren kan
inte själv godkänna sin annons. Vid avslag krävs i MVP en **ny annons**
med nytt fotobevis, eftersom redigering/nygranskning inte byggts än.

### Begränsningar och drift

- Ingen automatisk OCR eller automatisk status `approved`. Kodens text
  kontrolleras av en människa i den privata bilden.
- Bevisbilden visas aldrig publikt. Bygg gärna en administratörsvy och rutin
  för radering av övergivna/bekräftade foton innan riktig lansering.
- Presentkortskoden sparas i `private.gift_card_secrets`, inte i fotot.
- BankID, betalning, saldo-API, kortöverföring och utbetalning är **inte**
  implementerade. Gratisnivåns lagrings- och trafikgränser gäller.
- Kör migrationsfilen **bara en gång** och verifiera policys i Supabase;
  ingen integration är live bara för att koden finns på GitHub.


## PassItOn Trygg Affär – demoorder och dispyter (Kinguin-inspirerat)

**VIKTIGT: ALLT ÄR DEMO.** Inga pengar tas emot, hålls, överförs eller återbetalas,
och inga presentkortskoder levereras. 'Frigjord' och 'Återbetald' i denna funktion
är *endast databasstatusar för demonstration*. Dispyter omfattar inte verkliga
kortreklamationer, betalningsförmedling eller polisanmälningar.

### Installation

Efter de två befintliga migrationerna, kör **hela**:

\`backend/supabase/migrations/202610130002_add_demo_disputes.sql\`

i Supabase Dashboard → SQL Editor. Kör den först **innan** du testar den
nya frontend-versionen. Den skapar:

- \`demo_orders\`: inloggad köpare + säljare kopplade till en granskad annons;
  ordern är bara simulerad, med kontrolltid på 48 timmar.
- \`demo_disputes\`: max en reklamation per order, öppnas av köparen före deadline.
- \`demo_dispute_messages\`: append-only privat chatt och statuslogg.
- Privat Storage-bucket \`passiton-dispute-evidence\`, JPG/PNG/WebP max 3 MB,
  med uppladdning från köpare/säljare och läsning från berörda parter/admin.
- Säkerhet med RLS + serverstyrda RPC-anrop. Ingen klient får direkt skriva
  orderstatus, dispytstatus eller meddelandelogg.
- Intern administratörstabell och separat intern kö för misstänkta bedrägerier.

### Ge ditt eget konto adminrättigheter

Använd Supabase SQL Editor som projektägare och byt ut e-postadressen:

\`\`\`sql
insert into private.passiton_admins(user_id)
select id from auth.users where lower(email)=lower('DIN-ADMIN@EXEMPEL.SE')
on conflict (user_id) do nothing;
\`\`\`

Detta är den **enda** auktoriserade metoden i MVP:n: det finns ingen publik
registreringsknapp som gör någon till admin. Admin kan se alla
demoorder, öppnade dispyter och bevis; behandla detta som personuppgifter.

### Testa med två konton och admin

1. Skapa en säljarannons och godkänn fotobeviset manuellt enligt ovan.
2. Logga in med ett **annat konto** (köpare).
3. Kör demo-kassan för säljarens **riktiga, godkända** annons.
   Inga kortuppgifter används och ingen presentkortskod lämnas ut.
   Flera annonser i samma kassa skapar demoorder atomiskt.
4. Öppna **Mitt PassItOn → Order och dispyter**, välj ordern,
   och öppna en dispyt (minst 15 tecken).
5. Logga in på säljarens konto. Svara i den privata chatten.
6. Nu kan antingen köparen eller säljaren eskalera till PassItOn. Utan
   säljarens svar går det efter 24 timmar.
7. Med administratörskontot kan du läsa den eskalerade chatten,
   välja **simulerad återbetalning** eller **simulerad frigöring**,
   och vid misstanke flagga för separat intern bedrägerigranskning.
8. Inom 48 timmar kan köparen också godkänna en order som saknar dispyt.
   Efter deadline markeras odisputerade demoorder som frigjorda nästa gång
   köparen eller säljaren laddar sina order.

**Begränsning:** Utan Supabase Cron eller en server-worker sker 48-timmarsregeln
när en inloggad part laddar sina order, inte exakt vid en bakgrundstidpunkt.
Det spelar ingen roll för verkliga utbetalningar, eftersom inga sådana görs.

### Misstänkt bedrägeri och polisanmälningar

Admin kan flagga ett eskalerat ärende med intern notering. Noteringen
sparas i \`private.demo_fraud_reviews\` och syns **inte** för parterna.
Om en riktig polisanmälan senare görs *manuellt*, kan admin registrera
referensnumret i systemet. **PassItOn skickar ingen polisanmälan automatiskt.**
Att en tvist inte går att lösa är inte i sig bevis på brott.

Äkta utbetalningsfrysning, faktiska återbetalningar och automatisk
överföring får inte kopplas in utan godkänd betalpartner och juridisk granskning.
En intern 48-timmarsfrist begränsar inte nödvändigtvis bankens
kortreklamations- eller lagstadgade konsumenträttigheter.

## Kvarvarande demo-funktioner

Varukorg, demo-kassa och köphistorik sparas i webbläsarens `localStorage`, inte i
Supabase. Kassan tar bara emot testuppgifter: betalningsfälten läses inte av
JavaScript och alla formulärfält rensas efter bekräftelsen. Demoordern reserverar
inte annonsen och markerar den inte som såld.

Annonsberäkningen av utbetalning är endast ett exempel; riktig betalning,
kodöverföring, verifiering och markering av sålda annonser är inte aktiverade.
Ingen separat `profiles`-tabell behövs för nuvarande kontoflöde.
