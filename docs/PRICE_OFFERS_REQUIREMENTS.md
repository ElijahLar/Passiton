# PassItOn – kravspecifikation: prisförslag (alternativ B)

Status: Godkänd produktinriktning, teknisk specifikation för implementation. Datum: 2026-10-29.

## Syfte och avgränsning

Köpare ska kunna förhandla om en annons genom strukturerade prisförslag utan fritext, kontaktuppgifter eller kommunikation utanför plattformen. Första versionen (alternativ B) tar **inte** betalt eller reserverar pengar när ett bud skickas. Betalning ska ske via PassItOns ordinarie checkout efter accept; i befintlig MVP används demobetalning tills en godkänd betaltjänst finns. Befintlig chatt ska inte återanvändas för prisförslag.

## Beslutade affärsregler

| ID | Krav | Prioritet |
| --- | --- | --- |
| KR-01 | Endast inloggade användare får lägga prisförslag. Utloggade skickas till login och tillbaka till annonsen. | Måste |
| KR-02 | Prisförslag skickas utan fritext. Köparen kan endast ange belopp och bekräfta ett fördefinierat bud. | Måste |
| KR-03 | Budet ska vara minst 50 % av annonsens aktuella pris, avrundat uppåt till närmaste hela krona, och lägre än annonspriset. | Måste |
| KR-04 | Varje köpare kan ha högst fem aktiva prisförslag totalt över alla annonser. | Måste |
| KR-05 | En köpare kan ha högst ett aktivt prisförslag per annons, men får lägga bud på flera olika annonser även från olika säljare eller samma butik. | Måste |
| KR-06 | Ett obesvarat prisförslag gäller i 24 timmar från skapandet. Därefter upphör det automatiskt att gälla och platsen frigörs. | Måste |
| KR-07 | Säljaren kan acceptera, neka eller lämna ett strukturerat motbud utan fritext. Motbudet räknas till samma förhandling. | Måste |
| KR-08 | När säljaren accepterar får köparen 24 timmar på sig att slutföra köpet. Denna tid börjar vid accept, inte vid budets skapande. | Måste |
| KR-09 | Ett accepterat, ännu ej betalt bud räknas som aktivt inom femgränsen till dess det betalats eller löpt ut. | Måste |
| KR-10 | En förhandling som nekas, förfaller eller slutförs frigör en plats. Historiken ska ligga kvar. | Måste |
| KR-11 | Fem missade betalningar under rullande 30 dagar leder till en tillfällig spärr mot att skapa nya prisförslag i sju dagar. Vid 1–4 missar visas tilltagande information/varningar. | Måste |
| KR-12 | Missad betalning innebär: säljaren accepterade, 24 timmars betalningsfrist löpte ut, och inget köp genomfördes. Ett obesvarat/nekat bud räknas inte. | Måste |
| KR-13 | Användare visas med pseudonym/alias och annonsens namn i 'Mina prisförslag'. Inga personliga kontaktuppgifter exponeras. | Måste |
| KR-14 | Samtliga begränsningar kontrolleras i server/databas, inte enbart i frontend. RLS skyddar parternas data. | Måste |
| KR-15 | Checkout ska endast kunna nyttja accepterat, ej förfallet erbjudande för rätt inloggad köpare, och köp ska vara idempotent så samma presentkort inte säljs två gånger. | Måste |
| KR-16 | Säljaren kan välja att inte ta emot prisförslag på en annons. | Bör |
| KR-17 | Användaren får notis i appen vid bud, motbud, accept, avslag och nära deadline. | Bör |

## Definition av 'aktivt' och status

Aktivt = `pending_seller`, `countered` (inväntar köpare) eller `accepted_awaiting_payment`. Avslutat = `declined`, `expired`, `purchased`, `cancelled`, `payment_expired`.

Ett motbud ska ha en egen svarstid som i första versionen förslagsvis upphör vid samma ursprungliga `offer_expires_at`, om inte teamet uttryckligen beslutar annat. Första versionen bör begränsa förhandlingen till ett motbud åt gången. När köparen accepterar motbud räknas det som accept och betalningsfristen startar.

Vid accept ska den aktuella annonsen reserveras exklusivt för köparen under betalningsfristen, eller så måste gränssnittet tydligt informera att varan fortfarande kan köpas av annan. Rekommenderat för riktiga köp är **reservation med transaktionell låsning**, inklusive förhindrande av samtidiga accepterade bud på samma annons. Om reservation inte kan implementeras säkert i MVP ska detta markeras som demo och ej möjliggöra riktig betalning.

## Användarflöde

1. Köparen öppnar en aktiv annons och klickar 'Lämna prisförslag'.
2. Om utloggad: logga in/registrera; återvänd till aktuell annons.
3. Visa annonspris, lägsta giltiga bud, antal använda platser (t.ex. 3/5), val av belopp och förhandsvisning av en fast meddelandetext.
4. Skapa bud via autentiserad backend-operation. Vid gräns 5/5, spärr, egen annons, inaktiv annons eller ogiltigt belopp visas begripligt fel.
5. Säljaren ser budet i 'Mottagna prisförslag' med accept, neka eller motbud.
6. Köparen ser förhandlingen i 'Skickade prisförslag', med annonsnamn, anonymt säljarnamn, status och nedräkning.
7. Vid accept visas 'Betala inom 24 timmar' och knapp till checkout med accepterat belopp.
8. Vid slutfört köp markeras budet `purchased`; annonsen markeras såld och andra förhandlingar kring annonsen stängs utan att ge köpare missad-betalning-prick.
9. När betalningsfristen går ut markeras budet `payment_expired`, plats frigörs och köparen får en missad betalning om utebliven betalning beror på köparen.

## Supabase – föreslagen modell

`price_offers`:
- `id uuid primary key`, `listing_id uuid`, `buyer_id uuid`, `seller_id uuid`
- `listing_price_snapshot integer`, `offered_price integer`, `counter_price integer null`, `agreed_price integer null`
- `status text` med check/enum för statusarna ovan
- `offer_expires_at timestamptz`, `accepted_at timestamptz null`, `payment_due_at timestamptz null`
- `created_at`, `updated_at`, `completed_at` samt referens till order (`order_id`) när tillgänglig

`offer_payment_misses` (separat revisionslogg, inte endast ett redigerbart räknarfält):
- `id uuid`, `buyer_id uuid`, `offer_id uuid unique`, `missed_at timestamptz`, `reversed_at timestamptz null`, `reason text`

`offer_restrictions` (alternativt vy/beräkning):
- `buyer_id uuid`, `blocked_until timestamptz`, `updated_at`; spärr beslutas av backend och ska kunna rättas av administratör.

Pseudonymer ska vara servergenererade och inte identifierande. Återanvänd befintlig säker profilmodell om sådan redan finns; skapa inte en extra profilkälla utan behov.

### Databassäkerhet

- RLS: köpande respektive säljande part kan bara läsa sina egna förhandlingar. Säljaren kan inte se köparens e-post, intern användaridentifierare ska aldrig presenteras som profilidentifierare.
- Skapa bud/acceptera/neka/motbud/slutföra köp via transaktionella RPC:er eller Edge Functions med auktorisering och atomiska kontroller.
- Kontrollera 5-budsgränsen under lås per köpare för att hindra samtidiga POST-anrop att kringgå den.
- Exakt ett aktivt bud per (`buyer_id`, `listing_id`) genom partiellt unikt index eller låst procedur.
- Validera annonspris och 50 %-gränsen mot databasens aktuella pris (inte klientens pris).
- Schemalagt jobb kan hantera expirering, men varje RPC måste också pröva tidsgränser i realtid; `expires_at` är auktoritativ.
- Undvik åtkomst till presentkortskoder och privat annonsbevis under förhandling.

## Hantering av missade betalningar

- 1 miss: vänlig påminnelse.
- 2–4 missar: tydlig varning om risk för spärr.
- **5 missar inom rullande 30 dagar: inga nya bud under 7 dagar.** Redan accepterade köp kan slutföras.
- Registrera högst en miss per förhandling. Om tekniskt fel, borttagen annons, säljaren avbröt eller plattformen var otillgänglig ska administratör kunna återkalla missen.
- Beräkna gränsen på missar som inte återkallats. Missar äldre än 30 dagar belastar inte den rullande spärrberäkningen, men kan bevaras enligt datalagringspolicy.
- Efter de sju dagarna kan användaren skapa bud igen, förutsatt att ingen annan aktiv spärr gäller. En ny spärr ska endast utlösas av en ny miss, inte återaktiveras automatiskt från samma fem gamla händelser.

## Acceptanskriterier / tester

- [ ] Utloggad kan se annons men inte skapa bud; efter login går det att fortsätta.
- [ ] Pris 700 kr tillåter lägst 350 kr, 349 kr nekas; 700 kr eller mer hanteras som ordinarie köp, inte bud.
- [ ] Vid annonspris 701 kr tillåts lägst 351 kr (avrundning uppåt).
- [ ] En användare kan ha fem bud på fem olika H&M-annonser; ett sjätte aktivt nekas.
- [ ] Samtidiga skapandeanrop kan inte ge sex aktiva bud.
- [ ] Inget fritextfält eller godtyckliga meddelandefält accepteras av servern.
- [ ] Säljaren kan inte lägga bud på egen annons.
- [ ] Ett obesvarat bud upphör efter 24 h och frigör en plats utan betalningsmiss.
- [ ] Ett accepterat bud har 24 h betalningsfrist, räknas mot femgränsen och kan betalas till avtalat pris.
- [ ] En köpare kan inte använda någon annans prisförslag i checkout.
- [ ] Samma annons kan aldrig slutföras som två köp.
- [ ] Fem missar under 30 dagar ger sju dagars spärr; fyra ger endast varning.
- [ ] Varje accepterat men ej betalt bud kan ge högst en miss; fel kan återkallas.
- [ ] Säljare/köpare kan inte läsa tredje parts bud eller känsliga presentkortsuppgifter.
- [ ] Historik och status syns i 'Mina prisförslag' efter utgång.

## Föreslaget implementationspaket

1. SQL-migreringar, RLS, index, RPC, expirering och misslogg.
2. UI på annonssidan och kontosidans flikar 'Skickade'/'Mottagna', inklusive anonymt alias och tydliga tidsfrister.
3. Hook i demo-checkout som validerar accepterat bud och markerar köpet; ingen skarp betalningsreservation.
4. Tester för validering, samtidighet, RLS, köp/utgång och fem-miss-regeln.
5. Uppdatera README och backend-instruktioner om migreringsordning, testkonton och demonstrationsbegränsningar.

## Öppna tekniska beroenden före skarp lansering

- Val av betalningsleverantör, stöd för marknadsplatsutbetalningar och handel med presentkort.
- Atomisk reservation av annons och slutlig order-/betalningsbekräftelse.
- Om priset ändras efter att ett bud skickats: befintligt bud behåller snapshot, men kan bara accepteras om säljaren bekräftar villkoren; gör detta explicit i UI.
- E-postnotiser kräver utskickstjänst och användarinställningar; in-app-notiser räcker för MVP.
