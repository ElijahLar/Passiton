# NS-01 – Notiser, mail och registreringsval

Branch: `feature/notifications-email-preferences` (utgår från `main`).

## Vad är implementerat?

- Notisklocka i headern för inloggade användare, olästa antal, dropdown och notishistorik i Mitt PassItOn.
- Supabase Realtime med säker RLS, filtrering på olästa samt markering av lästa.
- Fyra frivilliga mailkategorier vid registrering, med **Välj alla** (inget förvalt).
- Inställningar i Mitt PassItOn med samma fyra kategorier och två separata bevakningar för sparade presentkort.
- Säker Auth-trigger lagrar registreringsval även om mailbekräftelse krävs.
- DB-triggers skapar notiser vid fotogranskning, prisförslag, prissänkningar, favoriter som säljs, demoorder, dispyter och meddelanden.
- Privat mailkö, kontroller av användarval, deduplicering, omförsök och Resend Edge Function.
- 6-timmarspåminnelse för accepterade prisförslag, via schemalagt SQL-anrop.

**Viktigt:** Det är en skol-MVP. Verifiering i UI innebär **manuellt godkänt fotobevis**, inte bekräftat saldo. Demoorder medför aldrig betalning, kvitto på verkligt köp, kodleverans eller utbetalning.

## Steg 1: Hämta branchen och kör lokalt

Från din lokala Passiton-mapp:

```bash
git fetch origin
git switch feature/notifications-email-preferences
python3 -m http.server 8000
```

Besök `http://localhost:8000/frontend/`. Om du vill köra regressionstester:

```bash
node --test tests/*.test.cjs
```

## Steg 2: Kör SQL i rätt ordning

Supabase Dashboard → **SQL Editor** → New query. Kör innehållet i:

`backend/supabase/migrations/202611160001_notifications.sql`

Kör först befintliga migrationer till och med `202611050001_saved_listings.sql` om de inte redan är installerade. Kör aldrig gamla migreringar på nytt i blindo om databasen redan används. NS-01 skapar tabellerna `notification_preferences`, `notifications` samt en privat kö i `private.notification_email_outbox`.

Äldre användare får alla frivilliga mail **avstängda**. Nya användares registreringsval sparas via Auth metadata i ett server-side triggerflöde.

### Kontrollera efter migrationen

Kör i SQL Editor:

```sql
select count(*) from public.notification_preferences;
select count(*) from public.notifications;
select status, count(*) from private.notification_email_outbox group by status;
```

Alla tre frågorna ska fungera utan tabellfel. Klockan fylls med riktiga händelser efter det att migrationen är på plats.

## Steg 3: Konfigurera riktiga mail

Vi använder **Resend** för frivilliga händelsemail. Du behöver ett Resend-konto, en verifierad avsändardomän och en API-nyckel. Använd aldrig en `service_role`-nyckel i `frontend/`.

I terminalen:

```bash
npx supabase login
npx supabase link --project-ref wcitckdgzjncglwymeks
npx supabase secrets set RESEND_API_KEY="din-resend-api-nyckel" NOTIFICATION_FROM="PassItOn <notiser@din-verifierade-doman.se>" PASSITON_SITE_URL="https://passiton.nu" NOTIFICATION_CRON_SECRET="en-lang-slumpad-hemlighet"
npx supabase functions deploy send-notification-emails --no-verify-jwt
```

Kör kommandona från repots rot. Ersätt endast exempelfälten med dina egna värden. Supabase tillhandahåller `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` automatiskt inne i Edge Functions.

**OBS:** Funktionen körs med JWT-kontroll avstängd endast för att en schemalagd serveruppgift ska kunna anropa den. Den kontrollerar i stället `x-notification-secret` på varje begäran. Använd en stark hemlighet och dela den aldrig i frontend eller GitHub.

## Steg 4: Schemalägg två jobb

I Supabase Dashboard aktiverar du vid behov **Cron (pg_cron)** och **HTTP (pg_net)** under integrations-/databasinställningar.

1. **Prisförslag:** Skapa ett SQL-jobb med intervallet `*/5 * * * *` och SQL:

   ```sql
   select private.notify_offer_payment_reminders();
   ```

2. **Mailutskick:** Skapa ett HTTP-jobb var minut (`* * * * *`), metod `POST`, URL:
   `https://wcitckdgzjncglwymeks.supabase.co/functions/v1/send-notification-emails`.
   Lägg till headern `x-notification-secret` med exakt samma hemlighet som `NOTIFICATION_CRON_SECRET`. Lämna kroppen tom eller använd `{}`.

Lagra schemaläggarens hemlighet i Supabase Vault eller motsvarande skyddad serverinställning; skriv den inte i migrationsfilen eller en delad SQL-historik. Om schemaläggnings-UI:t inte kan lagra en hemlig header säkert, använd Vault och ett pg_net-jobb eller annan serverbaserad schemaläggare.

Du kan provköra Edge Function med en POST från din egen terminal (byt `HEMLIGHET`):

```bash
curl -X POST "https://wcitckdgzjncglwymeks.supabase.co/functions/v1/send-notification-emails" -H "x-notification-secret: HEMLIGHET" -H "Content-Type: application/json" -d '{}'
```

**Viktigt:** Hemligheter i terminalkommandon kan hamna i shell-historik. Välj en skyddad hemlighetshanterare, eller använd `read -s` och en miljövariabel om du vill undvika det.

## Steg 5: Testa med två konton

1. Registrera användare A med enbart **Prisförslag** markerat, och bekräfta e-post.
2. Registrera användare B med **Välj alla** och bekräfta e-post.
3. Logga in som A och B och kontrollera att valen syns i Mitt PassItOn → Notiser.
4. B publicerar en annons och får sitt fotobevis granskat av admin.
5. A lämnar ett prisförslag till B. B ska få en notis, och mail om kategorin är aktiv.
6. B accepterar. A ska få notis och eventuellt mail. När det återstår högst sex timmar ska påminnelsen skapas.
7. A sparar en godkänd annons. Sänk priset via säljarkontot. A ska få prissänkningsnotis; mail endast om det avancerade alternativet är aktiverat.
8. Öppna notisklockan, markera som läst och kontrollera historiken. Stäng därefter av Prisförslag och kontrollera att nya **frivilliga** mail uteblir.

## Tekniska begränsningar

- Ingen riktig betaltjänst är ansluten. Demoorder benämns alltid demo i notiserna.
- Påminnelser kräver ett aktivt Cron-jobb; mail kräver även Resend, deployad Edge Function och HTTP-jobbet.
- E-postkön är byggd för idempotens, men externa mailleverantörer kan i sällsynta fall leverera dubbelt vid timeout. Resends `Idempotency-Key` minskar den risken.
- Notishistoriken visar de senaste 200 händelserna. Storskalig paginering kan byggas senare.
- Bevaka Leveransstatus i `private.notification_email_outbox` och Edge Functions-loggarna när du testar.
- Denna patch är inte kopplad till någon riktig betalning eller automatisk presentkortssaldoverifiering.
