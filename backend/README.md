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

## Kvarvarande demo-funktioner

Varukorg, demo-kassa och köphistorik sparas i webbläsarens `localStorage`, inte i
Supabase. Kassan tar bara emot testuppgifter: betalningsfälten läses inte av
JavaScript och alla formulärfält rensas efter bekräftelsen. Demoordern reserverar
inte annonsen och markerar den inte som såld.

Annonsberäkningen av utbetalning är endast ett exempel; riktig betalning,
kodöverföring, verifiering och markering av sålda annonser är inte aktiverade.
Ingen separat `profiles`-tabell behövs för nuvarande kontoflöde.


## Stripe Identity – säljarverifiering

Stripe Identity körs i **testläge** och används som ett separat krav för att få
publicera annonser. Supabase Auth fortsätter att vara kontosystemet.

### 1. Kör Identity-migreringen

Kör följande fil i Supabase Dashboard → SQL Editor efter den befintliga
annonsmigreringen:

`backend/supabase/migrations/202610070001_create_identity_verifications.sql`

Den skapar `public.identity_verifications`, gör statusen läsbar endast för den
inloggade användaren och uppdaterar `create_gift_card_listing` så att endast
användare med `status = 'verified'` kan publicera. Nya annonser får också en
snapshot i `seller_identity_verified`.

### 2. Lägg Stripe-hemligheter i Supabase

Öppna Supabase Dashboard → Edge Functions → Secrets och lägg in:

- `STRIPE_SECRET_KEY` – Stripes nya **test secret key**.
- `PASSITON_IDENTITY_RETURN_URL` – sidan Stripe ska skicka tillbaka användaren
  till, till exempel `http://localhost:8000/frontend/` vid lokal testning.
- `STRIPE_IDENTITY_WEBHOOK_SECRET` – signing secret från Stripe-webhooken som
  skapas i nästa steg.

Secret keys får aldrig läggas i frontend, `supabase-config.js` eller Git.

### 3. Deploya Edge Functions

Från repots rot med Supabase CLI kopplad till projektet:

```bash
supabase functions deploy create-identity-session
supabase functions deploy stripe-identity-webhook
```

`create-identity-session` kräver en giltig Supabase-användarsession.
`stripe-identity-webhook` är publik för Stripe men verifierar alltid
`Stripe-Signature` med webhookens signing secret.

### 4. Skapa Stripe Identity-webhook

Skapa en webhook endpoint i Stripe **test mode** som pekar på:

`https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/stripe-identity-webhook`

Prenumerera på:

- `identity.verification_session.processing`
- `identity.verification_session.requires_input`
- `identity.verification_session.verified`
- `identity.verification_session.canceled`
- `identity.verification_session.redacted`

Kopiera endpointens `whsec_...` signing secret till
`STRIPE_IDENTITY_WEBHOOK_SECRET` i Supabase.

### 5. Testa

1. Kör webbappen via HTTP och logga in.
2. Öppna **Mitt Passiton**.
3. Välj **Verifiera identitet**.
4. Slutför Stripes testverifiering.
5. När Stripe har skickat webhook-resultatet visar kontot **Verifierad**.
6. Försök publicera en annons. Både frontend och databasfunktionen kräver nu
   verifierad identitet.

Passiton lagrar bara verifieringsstatus, Stripe-sessionens ID och felkod. Inga
ID-handlingar, selfies eller verifierade personuppgifter kopieras till Supabase.

## Stripe Payments / Connect

Riktiga betalningar är fortfarande inte implementerade. Stripe-integrationsplanen
i `backend/stripe-integration-plan.md` rekommenderar Marketplace + Connect och
Separate Charges and Transfers eftersom Passiton behöver kunna vänta med
överföringen till säljaren.

Aktivera inte riktiga betalningar eller payouts innan Stripe har godkänt
Passitons presentkorts/stored-value-affärsmodell.
