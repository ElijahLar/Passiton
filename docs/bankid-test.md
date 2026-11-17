# Testa säljarverifiering med BankID

Förhandsvisningen kör Passitons säljsida lokalt och använder BankID:s riktiga test-API. Du behöver Node.js 22 eller senare, en dator för webbsidan och en telefon med ett [test-BankID från BankID:s testportal](https://developers.bankid.com/test-portal/testing). Följ BankID:s instruktioner för testläge. Använd gärna en reservtelefon eftersom testläget påverkar appens koppling till ditt vanliga BankID.

## Kör förhandsvisningen

Klona testgrenen från GitHub, eller hämta den som ZIP och packa upp den. Kör sedan följande från kopians rot:

    cd backend/bankid-preview
    npm ci
    npm run setup
    npm start

1. Öppna [Sälj i förhandsvisningen](http://127.0.0.1:8787/frontend/#passiton=sell) på datorn.
2. Klicka på **Starta BankID-test**. Öppna BankID-appen i testläge på telefonen och skanna den animerade QR-koden direkt från datorskärmen. Koden kan skannas i upp till 30 sekunder efter att BankID har skapat ordern.
3. Bekräfta i appen. Säljsidan visar **BankID-testet lyckades** när BankID:s test-API har bekräftat identifieringen.
4. Ladda om sidan för att kontrollera status i samma webbläsare. För att testa ett nytt försök eller avbrott, öppna ett privat fönster.
5. Avsluta den lokala servern med Ctrl+C.

För test utan testkonto kör du stegen ovan precis som de står. Förhandsvisningen lyssnar på loopback, så telefonen används för att skanna QR-koden på datorns skärm. Knappen **Öppna BankID** kan prova samma-enhetsstart när en kompatibel BankID-klient finns på den enhet där webbsidan körs. Gå tillbaka till webbsidan manuellt efter det lokala testet.

Setup hämtar BankID:s gemensamma testcertifikat och testmiljöns rotcertifikat från en [versionslåst källa som dokumenterar certifikatens ursprung](https://docs.activelogin.net/articles/bankid.html#certificates) och verifierar filernas kontrollsummor. Certifikaten stannar i den git-ignorerade katalogen .bankid-test. Servern verifierar TLS och ansluter till appapi2.test.bankid.com på port 443. Om webbläsaren visar ett anslutningsfel, kontrollera att datorns nät når den adressen.

### Om BankID säger att QR-koden har gått ut eller saknas

Starta ett nytt test och använd **Skanna QR-kod** inuti BankID-appen på den enhet där ditt test-BankID finns. Om felet återkommer direkt, prova **Log in with a Test BankID** i [BankID:s testportal](https://developers.bankid.com/test-portal/testing) med samma enhet. Om portalens testinloggning fungerar, anteckna vad BankID-appen visar och kopiera raderna som börjar med [BankID-test] i terminalen där npm start körs. Loggen visar om BankID skapade ordern, om appen startade och vilket fel BankID rapporterade. Den innehåller inga QR-data, namn eller personnummer.

## Testa med ett separat Supabase-konto

Det här steget behövs när du vill prova identifieringen tillsammans med Passitons vanliga e-postinloggning och testannonser. Använd ett separat Supabase-projekt eller din lokala Supabase-stack. Passitons befintliga projekt är spärrat i förhandsvisningen.

1. Förbered testprojektet enligt [backend-guiden](../backend/README.md), inklusive databasens migreringar för testannonser och tillåtna URL:er för testkonton. För lokal e-postbekräftelse behöver projektet tillåta http://127.0.0.1:8787/frontend/.
2. Skapa en fil som heter .env i backend/bankid-preview. Ange projektets URL och publika nyckel på varsin rad:

       PASSITON_TEST_SUPABASE_URL=https://DittTestprojekt.supabase.co
       PASSITON_TEST_SUPABASE_KEY=sb_publishable_...

3. Starta om förhandsvisningen. Logga in med ett konto från testprojektet och öppna **Sälj**. När testidentifieringen lyckas låser sidan upp knapparna för fotobevis och annonsinlämning. Använd enbart demouppgifter och testfoton.

Servern kontrollerar testkontots Supabase-session och binder BankID-resultatet till kontot och den lokala webbläsarsessionen. Resultatet finns i serverns minne tills webbsessionen löper ut eller servern startas om. Passiton sparar varken namn eller personnummer från BankID-svaret. Annonsknapparnas BankID-spärr gäller i förhandsvisningens gränssnitt. Databasen fortsätter att använda sina befintliga regler för annonsinlämning.

## Källkod och kontroller

- Kör npm test i backend/bankid-preview för att kontrollera orderhantering, QR-kod, avbrott och isolering med simulerade svar.
- En vanlig statisk GitHub Pages-publicering startar inte Node-servern som behövs för BankID-testet.
- [BankID:s API-översikt](https://developers.bankid.com/api-references/auth--sign/overview)
- [BankID:s flöde för QR-kod på en annan enhet](https://developers.bankid.com/use-cases/mobile-bankid-on-another-device)
