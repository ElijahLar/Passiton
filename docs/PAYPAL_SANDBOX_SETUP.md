# PayPal sandbox – första betalningstestet

## Omfattning

Branch: `feature/paypal-sandbox`. Första steget är en **separat testbetalning på
10,00 SEK** med PayPal Orders v2 och den fortsatt stödda JavaScript SDK v5.
Inloggning sker med ett befintligt Passiton/Supabase-konto. Betalaren använder
sedan ett annat Personal sandbox-konto i PayPal-fönstret.

Detta är en vanlig testbetalning till **ett Business sandbox-konto**. Det är
inte en färdig marknadsplatsintegration: säljaranslutning, förmedlingsavgift,
uppdelning av betalning, 48 timmars innehållande, säljarutbetalning,
återbetalning, webhook och leverans av värdebevis ingår inte. Ett lyckat test
bekräftar den tekniska sandboxanslutningen, inte godkännande för livehandel.

Testsidan laddar inte den befintliga appens kassa och gör inga anrop till
`demo_create_orders`, `demo_buy_accepted_offer` eller annonsfunktionerna.
Den ändrar inte annonser, demoorder, dispyter eller appens köphistorik.
Den använder samma Supabase Auth-session på samma origin. Utloggning på
testsidan loggar därför också ut den lokala appen i samma webbläsare.

## Status vid leverans

Koden och automatiserade tester är förberedda. SQL-filen har **inte** körts i
det gemensamma Supabase-projektet. Edge Function och hemligheter har **inte**
installerats där. Ingen faktisk PayPal sandboxbetalning har genomförts utan
era uppgifter. Inget är sammanslaget till `main` eller publicerat på domänen.

## 1. Hämta branchen och starta sidan

I en separat lokal kopia av repot, från repots rot:

```bash
git fetch origin
git switch --track origin/feature/paypal-sandbox
python3 -m http.server 8000 --bind 127.0.0.1
```

Om branchen redan finns lokalt: `git switch feature/paypal-sandbox`.
Öppna **http://localhost:8000/frontend/paypal-sandbox.html**. Den vanliga sidan
ligger kvar på `/frontend/`. Ändra inte GitHub Pages källa till testbranchen.

## 2. Lägg till endast den nya tabellen i gemensamma Supabase

Öppna ert befintliga projekt → SQL Editor och kör endast:

`backend/supabase/migrations/202611120001_paypal_sandbox.sql`

Filen skapar `public.paypal_sandbox_payments`, dess behörigheter och RLS.
Inloggade användare kan bara läsa egna rader. Endast serverns `service_role`
kan skriva. Tabellen har fasta begränsningar för sandbox, SEK och 10 kr.
Den innehåller order-id, capture-id, testare och status; inga PayPal-lösenord,
kortuppgifter, access tokens, API-hemligheter eller värdebeviskoder sparas.

Kör inte alla äldre migrationer igen och använd inte `supabase db push` mot
det gemensamma projektet utan att först kontrollera dess migrationshistorik.
Databasändringen gäller direkt oavsett GitHub-branch. Den nya filen ändrar
inga befintliga tabeller, policies eller funktioner. Den ska köras en gång.

## 3. Förbered sandboxkonton och inställningar

I PayPal Developer Dashboard, välj **Sandbox**:

1. Välj/skapa en REST-app för mottagarens **Business sandbox-konto**.
2. Hämta appens sandbox **Client ID** och **Secret**.
3. Hämta samma mottagarkontos **Merchant ID / Account ID**. Använd inte
   köparens ID och inte appens Client ID som merchant-id.
4. Ha ett separat **Personal sandbox-konto** med testsaldo som köpare.

I Supabase → Authentication → Users, kopiera **User UID** för de befintliga
Passiton-konton som ska få testa. En tom testlista nekar alla användare.

Kopiera `backend/supabase/.env.example` till en fil **utanför repot och den
lokala webbserverns mapp**, exempelvis `~/.config/passiton/paypal-sandbox.env`
(skapa katalogen först). Fyll i värdena lokalt och sätt
`PAYPAL_SANDBOX_ENABLED=true` när de är klara. Flera testares UID separeras
med komma. `PAYPAL_SANDBOX_ALLOWED_ORIGINS` innehåller som standard endast
localhost och 127.0.0.1 på port 8000. Lägg inte till produktionsdomänen.

Lägg aldrig PayPal Secret eller Supabase service-role-nyckeln i frontend,
GitHub, README, skärmbilder eller chatten. Supabases **publishable key** i
befintlig frontend är däremot avsedd att vara offentlig.

## 4. Installera endast den nya serverfunktionen

Med Supabase CLI installerad och inloggad, från repots rot:

```bash
supabase secrets set --project-ref wcitckdgzjncglwymeks --env-file "$HOME/.config/passiton/paypal-sandbox.env"
supabase --workdir backend functions deploy paypal-sandbox --project-ref wcitckdgzjncglwymeks
```

Kontrollera projektref mot ert projekt innan kommandona körs.
Konfigurationen gäller endast den nya funktionen `paypal-sandbox`.
`verify_jwt=false` behövs för att funktionen själv ska kunna validera även
nyare Supabase JWT-signering: **varje riktigt anrop** verifierar ändå
Bearer-token med Supabase Auth `/auth/v1/user` och kontrollerar testlistan
innan databas- eller PayPal-anrop tillåts. OPTIONS är endast CORS-preflight.
Ingen anonym betalningsåtkomst ges. Ändra inte andra funktioners inställningar.

`SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` injiceras av hostade Supabase
Edge Functions och ska inte läggas i frontend eller exempel-filen.

## 5. Prova betalningen

1. Öppna den lokala testsidan och logga in med ett tillåtet Passiton-testkonto.
2. Klicka på PayPal och logga in med **Personal sandbox-kontot** i popupen.
3. Godkänn 10,00 SEK. Servern kontrollerar orderns mottagare, interna
   referens, valuta och belopp och genomför capture.
4. Endast verifierad capture med status `COMPLETED` ger bekräftad betalning.
   `PENDING` visas som väntande. Ingen vara eller värdebeviskod levereras.
5. Kontrollera transaktionen i PayPals sandbox och motsvarande rad i
   `paypal_sandbox_payments`. Du ska kunna se order-id och capture-id.
6. Prova att stänga PayPal-fönstret och att återöppna sidan. Knappen
   **Kontrollera betalningen** hämtar verklig orderstatus från PayPal igen.

Testets begärande-id och order-id sparas lokalt per Supabase-användare. De
är inte hemligheter. Behåll samma test om ett svar försvinner. Create och
capture använder stabila `PayPal-Request-Id` på servern för återförsök.
Servern hämtar ordern före capture så att ett tidigare lyckat capture inte
görs igen. Om PayPal hann genomföra capture men databasuppdateringen
misslyckades, återställs status med nästa kontroll. Äldre osäkra create-försök
utan sparat PayPal-order-id stoppas efter tre timmar; kontrollera då sandbox-
panelen innan du väljer **Nytt test**. Radera inte lagringsdata mitt i ett test.

Det finns ingen webhook i detta steg. Status uppdateras vid capture eller
manuell kontroll. Därför finns ingen automatisk leverans eller utbetalning.

## Felsökning och avstängning

| Meddelande | Kontrollera |
| --- | --- |
| Testet är inte aktiverat | `PAYPAL_SANDBOX_ENABLED=true` i funktionens secrets. |
| Kontot är inte tillagt som testare | Supabase User UID finns i testlistan. |
| Testsidans adress är inte tillåten | Origin inklusive port; ingen sökväg eller avslutande slash. |
| Serverfunktionen kunde inte anropas / CORS-fel | Funktionen är installerad, rätt config används och origin är tillåten. |
| Testbetalningen kunde inte sparas | Den nya SQL-filen har körts och tabellen är synlig i Data API. |
| PayPal nekade sandboxinloggningen | Appens sandbox Client ID och Secret hör ihop. |
| PayPal-ordern matchar inte | Merchant ID tillhör appens mottagarkonto. |
| Betalningen behandlas | Kontrollera igen och jämför med PayPals sandboxpanel. |

Stäng av genom att sätta `PAYPAL_SANDBOX_ENABLED=false` i Supabase secrets.
Det påverkar bara denna funktion. Ta inte bort andra projektinställningar.

## Verifiering

Från repots rot, med Node.js 22 eller senare:

```bash
node --test tests/*.test.cjs tests/*.test.mjs
```

De nya testerna kör den verkliga serverhanteraren med simulerade HTTP-svar:
auth, testlista, origins, serverstyrt belopp/mottagare, ägarskap, idempotens,
avbrutna capture-svar, databasfel och väntande/felaktiga betalningar.
Det ersätter inte en faktisk körning av SQL/RLS i Supabase eller ett
fullständigt sandboxköp efter installation.

## Referenser

- [PayPal Orders v2](https://developer.paypal.com/api/orders/v2)
- [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/)
- [PayPal JavaScript SDK](https://developer.paypal.com/sdk/js/)
- [Supabase – Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
