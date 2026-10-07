# Stripe-integration för Passiton

## Mål

Passiton är en andrahandsmarknad för presentkort. Stripe ska användas för:

1. **Identity** – verifiera säljarens identitet innan annonser får publiceras.
2. **Payments/Connect** – framtida riktiga köp och utbetalningar till säljare.

## Fas 1 – Stripe Identity

Den här branchen implementerar Identity i testläge.

Flöde:

1. Användaren loggar in med Supabase Auth.
2. Kontosidan hämtar användarens status från `public.identity_verifications`.
3. Användaren väljer **Verifiera identitet**.
4. Frontend anropar Supabase Edge Function `create-identity-session`.
5. Edge Function autentiserar Supabase-användaren och skapar eller återanvänder en
   Stripe Identity VerificationSession.
6. Användaren skickas till Stripes hostade verifieringsflöde.
7. Stripe skickar signerade webhook-events till `stripe-identity-webhook`.
8. Webhook-funktionen uppdaterar endast status i Supabase. Passiton lagrar inga
   ID-handlingar, selfies eller verifieringsrapporter.
9. Databasfunktionen `create_gift_card_listing` kontrollerar att användaren har
   status `verified`. Kontrollen ligger alltså server-side och kan inte kringgås
   genom att manipulera frontend.

## Secrets

Följande ska ligga som Supabase-secrets och aldrig i frontend eller Git:

- `STRIPE_SECRET_KEY`
- `STRIPE_IDENTITY_WEBHOOK_SECRET`
- `PASSITON_IDENTITY_RETURN_URL`

Den publishable Stripe-nyckeln behövs inte för det hostade Identity-flödet.

## Fas 2 – Payments och utbetalningar

Passiton är en marketplace där pengar ska gå från köpare till tredjepartssäljare.
Stripes integrationsplanerare har bekräftat att Passiton passar som en **Stripe
Connect Marketplace**. För den planerade köpmodellen rekommenderas **Separate
Charges and Transfers**, eftersom Passiton behöver kunna ta emot köparens betalning
och vänta med överföringen till säljaren tills leverans/verifieringsvillkoren är
uppfyllda.

Stripe klassificerar samtidigt presentkort/stored value som en begränsad
verksamhetskategori. Ingen riktig betalning eller payout ska därför aktiveras innan
Stripe uttryckligen har godkänt Passitons affärsmodell.

När Stripe har godkänt användningsfallet bör nästa implementation omfatta:

- Connected accounts för säljare med transfer/recipient-funktion.
- Embedded Connect-onboarding och Stripe-hanterad onboarding-UI.
- Connect-statuskontroll innan en säljare kan ta emot transfers.
- Server-side skapade Checkout Sessions eller PaymentIntents.
- Webhooks som enda källa för betald orderstatus.
- Atomisk reservation/markering av annons för att undvika dubbel försäljning.
- Leverans av presentkortskod först efter rätt betalningsstatus.
- Refund/chargeback-flöde.
- Payout till connected account efter Passitons regler.
- Passitons transaktionsavgift genom att överföra ett lägre belopp till säljaren
  än den ursprungliga charge-summan; `application_fee_amount` ska inte användas
  med Separate Charges and Transfers.
- Radar for Platforms/riskhantering eftersom plattformen bär marketplace-risken.
