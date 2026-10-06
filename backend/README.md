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
