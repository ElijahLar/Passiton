# PayPal sandbox – Platform Partner App

Testbranchen använder nu en Platform-app och en separat, fast konfigurerad
sandbox-säljare. Säljaren ansluts genom Partner Referrals (THIRD_PARTY,
EXPRESS_CHECKOUT). Därefter kan en Personal sandbox-köpare betala 10 SEK till
säljaren genom plattformsappen. Ingen annons eller demoorder påverkas.

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

För en helt ny installation körs 001 först och sedan 002. Kör inte övriga
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
supabase --workdir backend functions deploy paypal-sandbox --project-ref wcitckdgzjncglwymeks
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
testare kan skapa onboardinglänkar. Plattformsavgift, fördröjd utbetalning,
återbetalningsgränssnitt, webhook och värdebevisleverans ingår inte ännu.
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
