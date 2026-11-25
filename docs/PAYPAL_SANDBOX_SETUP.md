# PayPal sandbox – Platform Partner App

Testbranchen använder nu en Platform-app och en separat, fast konfigurerad
sandbox-säljare. Säljaren ansluts genom Partner Referrals (THIRD_PARTY,
EXPRESS_CHECKOUT) med PAYMENT, REFUND, PARTNER_FEE och DELAY_FUNDS_DISBURSEMENT. Därefter kan en Personal sandbox-köpare betala 10 SEK till
säljaren genom plattformsappen. Ingen annons eller demoorder påverkas.

## Uppgradera det fungerande testet: avgift och fördröjning

1. I Sandbox → Platform Partner App: slå på **Platform Fee**. Appen måste även
   tillåta **DELAY_FUNDS_DISBURSEMENT**. Om inställningen saknas eller PayPal nekar
   API-anropet, be PayPal aktivera funktionen för just sandboxplattformen.
2. Kör endast `backend/supabase/migrations/202611250001_paypal_fee_disbursement.sql`
   i en ny SQL-snippet. Kör inte om 001 eller 002. Ingen `db push`.
3. Hämta testbranchen med `git pull --ff-only` och installera om endast funktionen:
   `supabase --workdir backend functions deploy paypal-sandbox --remote=wcitckdgzjncglwymeks`
   (CLI 3). Alla åtta befintliga Secrets används; inga nya behövs.
4. Starta den lokala webbservern enligt nedan, ladda om testsidan och välj **Nytt test**.
5. Skapa en **ny anslutningslänk** och logga in som säljaren för att godkänna även
   PARTNER_FEE och DELAY_FUNDS_DISBURSEMENT. Den gamla anslutningen räcker inte som
   bevis för dessa rättigheter. Knappen för säljarstatus kontrollerar grundanslutningen;
   PayPal kontrollerar de extra funktionerna vid onboarding/orderanrop.
6. Betala 10 SEK med ett separat Personal-sandboxkonto. Servern sätter 1 SEK i
   plattformsavgift och DELAYED. Säljaren får 9 SEK **före PayPals egna avgifter**.
7. Kontrollera avgiften och det innehållna beloppet i PayPal sandbox innan frigörande.
   Databasens `status=completed` betyder capture klar, inte att säljaren fått pengarna.
8. Klicka **Frigör testpengarna till säljaren** och bekräfta. Det skickar en referenced
   payout för den sparade capture-transaktionen, inte en separat vanlig Payouts-betalning.
9. Kontrollera slutresultatet hos säljaren och plattformen i PayPal sandbox. `accepted`
   på testsidan betyder endast att PayPal accepterat anropet, inte slutförd utbetalning.

PayPal frigör automatiskt efter **28 dagar**. Detta är fördröjning hos PayPal, inte
obegränsad escrow och inte utbetalning till säljarens bankkonto. Live-behörighet och
Godkännande för PassItOns affärsmodell följer inte av ett lyckat sandboxtest.

### Avstämning och avbrutna frigöranden

Nya rader har `flow_version=2`, `platform_fee_amount=1.00`, `disbursement_mode=DELAYED`
och plattformens Merchant ID. Äldre rader behåller version 1 och kan inte frigöras här.
Belopp, avgift, mottagare, valuta och orderreferens kontrolleras på servern.

`release_status` är separat från betalningsstatus:
- `not_requested`: inget frigörande har påbörjats av testsidan.
- `requested`: anropet har reserverats atomärt och kan ha skickats; resultatet kan vara osäkert.
- `accepted`: ett svar med rätt capture-referens och payout item-ID har sparats.

Dubbelklick, samtidiga anrop och omladdning får aldrig skicka två frigöranden.
Vid timeout, oväntat svar eller databasfel efter frigörande lämnas `requested` kvar.
Testsidan skickar då INTE igen automatiskt, även om PayPal nekade första anropet.
Kontrollera PayPals transaktion och eventuell debug-ID med PayPal innan någon manuell
återställning. Det finns ingen knapp som återställer denna spärr. Automatisk avstämning
via webhook/utbetalningsstatus är ett framtida steg. Ett lyckat HTTP-svar är inte bevis
för att säljaren faktiskt fått pengarna. Kontrollera detta manuellt även för `accepted`.

## 1. Uppdatera lokal kopia

På `feature/paypal-sandbox`, hämta ändringarna med `git pull --ff-only`.
Kör från repots rot:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Öppna http://localhost:8000/frontend/paypal-sandbox.html.
Publicera inte testbranchen genom GitHub Pages.

## 2. Uppdatera Supabase-tabellen

Du har redan kört `202611120001_paypal_sandbox.sql`. Kör INTE om den.
Kör nu endast `backend/supabase/migrations/202611120002_paypal_platform.sql`
i SQL Editor. Den lägger till `seller_merchant_id` i testtabellen och behåller
alla tidigare rader. Gamla testorder utan denna koppling får inte betalas
med plattformsappen. Välj Nytt test på testsidan efter uppdateringen.

För en helt ny installation körs 001, sedan 002 och slutligen 202611250001_paypal_fee_disbursement.sql. Kör inte övriga
äldre migrationer igen och använd inte db push mot gemensamma projektet.

## 3. Inställningar i Supabase Edge Function Secrets

| Namn | Värde |
| --- | --- |
| PAYPAL_SANDBOX_CLIENT_ID | Client ID från Platform Partner App i Sandbox |
| PAYPAL_SANDBOX_CLIENT_SECRET | Secret från samma Platform-app |
| PAYPAL_SANDBOX_PARTNER_ID | Plattformskontots Merchant ID |
| PAYPAL_SANDBOX_MERCHANT_ID | Det separata säljarkontots Merchant ID |
| PAYPAL_SANDBOX_BN_CODE | Appens/partnerintegrationens PayPal Partner Attribution ID (BN code) |
| PAYPAL_SANDBOX_TEST_USER_IDS | Tillåtna Passiton-användares Supabase User UID, kommaseparerade |
| PAYPAL_SANDBOX_ALLOWED_ORIGINS | http://localhost:8000,http://127.0.0.1:8000 |
| PAYPAL_SANDBOX_ENABLED | true |

BN-koden är inte appnamnet, Client ID eller Merchant ID. Om den inte visas i
din Platform-app, kontrollera sandboxinställningarna med PayPal. Hitta inte
på ett värde och använd inte en annan plattforms kod. Plattformens API-behörighet
måste finnas i sandbox; att skapa två konton ger inte säljarmedgivande.

SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY tillhandahålls av hostade Edge
Functions. Lägg inga hemligheter i frontend, GitHub eller chatten.
Säljarens API Secret behövs inte. Säljaren ger behörighet via PayPal-inloggning.

## 4. Installera serverfunktionen

Använd Supabase CLI inloggad på rätt projekt. Du kan lägga secrets direkt i
Supabases panel eller kopiera `.env.example` till en privat fil UTANFÖR repot
/webbserverns mapp, exempelvis ~/.config/passiton/paypal-sandbox.env.

```bash
supabase secrets set --project-ref wcitckdgzjncglwymeks --env-file "$HOME/.config/passiton/paypal-sandbox.env"
supabase --workdir backend functions deploy paypal-sandbox --remote=wcitckdgzjncglwymeks
```

Kontrollera projektref innan körning. verify_jwt=false gäller enbart denna
funktion: den validerar varje Bearer-token med Supabase Auth och kräver att
användaren finns i testlistan. Ändra inte andra funktioners inställningar.

## 5. Anslut säljaren

1. Logga in på testsidan med ett tillåtet Passiton-konto.
2. Välj Skapa anslutningslänk och godkänn att starta anslutningen.
3. Öppna länken i ett separat fönster. Logga in med SÄLJARENS sandboxkonto,
   inte plattformskontot. Godkänn PayPals behörigheter och slutför flödet.
4. Återvänd manuellt till testsidan och välj Kontrollera säljaranslutningen.

Servern kontrollerar den konfigurerade säljaren genom PayPals
merchant-integrations API: mottagningsförmåga, bekräftad e-post och
betalningsbehörighet för just plattformsappens Client ID. Parametrar från
webbläsaren används aldrig som bevis för att onboarding är klar.
Om du ansluter fel sandboxkonto tillåts ändå inte betalning till detta konto;
anslut rätt säljare vars Merchant ID är konfigurerat på servern.

## 6. Testköp

Använd ett separat Personal sandbox-konto som köpare i PayPal-fönstret.
Godkänn 10 SEK. Servern använder plattformens access token tillsammans med
säljarens PayPal-Auth-Assertion och partnerns attribution-header. Mottagare,
belopp och valuta styrs av servern och kontrolleras före bekräftelse.

Kontrollera resultatet i säljarens PayPal sandbox och i tabellen
paypal_sandbox_payments. Ingen faktisk vara levereras. Vid avbrutet svar,
använd Kontrollera betalningen innan Nytt test. Stabilt PayPal-Request-Id
skyddar återförsök och servern hämtar ordern före capture. Pending visas inte
som lyckad betalning. Osäkra create-försök äldre än tre timmar stoppas.

## Omfattning och verifiering

Detta test stöder en fast säljare, ingen publik säljarregistrering. Tillåtna
testare kan skapa onboardinglänkar. Plattformsavgift (1 SEK), fördröjd utbetalning och manuellt frigörande ingår i version 2.
Återbetalningsgränssnitt, webhook, automatisk utbetalningsavstämning och värdebevisleverans ingår inte.
REFUND begärs som del av partnerbehörigheterna men inga återbetalningsanrop
är implementerade. Servern använder endast PayPals sandboxadress.

Koden är testad med simulerade svar. Installation i Supabase och ett verkligt
sandboxköp måste verifieras med era konton. Ingen automatisk deployment sker
från denna branch. Stäng av med PAYPAL_SANDBOX_ENABLED=false.

```bash
node --test tests/*.test.cjs tests/*.test.mjs
```

Referenser:
- https://developer.paypal.com/platforms/seller-onboarding
- https://developer.paypal.com/platforms/seller-onboarding/before-payment/
- https://developer.paypal.com/platforms/checkout/standard/integrate
- https://developer.paypal.com/api/rest/reference/idempotency/

Referenser för avgift och fördröjning:
- https://developer.paypal.com/platforms/checkout/delayed-disbursement/
- https://developer.paypal.com/platforms/seller-onboarding/onboarding-checklist/
