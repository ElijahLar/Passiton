# Mätning och cookies för Passiton (GTM + GA4)

Det här är en **kodinstallation**, inte en publicerad Analytics-/cookie-konfiguration. Passiton är i nuläget en skol-MVP med **demo-kassa** utan riktiga betalningar.

- GTM-container: `GTM-53QB6XX9`
- GA4 Measurement ID: `G-P7F3T8541P`
- Webbplats: `https://www.passiton.nu/frontend/` (repo-roten omdirigerar hit)
- Kod: `frontend/index.html`, `frontend/js/analytics.js`, `frontend/js/app.js`

## Implementerat i koden

1. GTM installeras **en gång** i `frontend/index.html`. Lägg inte ett extra GA4-`gtag.js` direkt på sajten.
2. Consent Mode v2 startar med `denied` för statistik/annonsering och `granted` för nödvändig säkerhetslagring. CMP:n måste uppdatera statusen efter besökarens val.
3. En dataminimerad `dataLayer` pushar händelser för navigering, annonsvisningar, varukorg, demo-kassa, annonsinskick, inloggning och sökning.
4. Ingen banner skapas i webbplatsens kod. Det var ett uttryckligt önskemål: bannern ska konfigureras via GTM/CMP.

**Viktigt:** `denied` ensamt är inte detsamma som Basic Consent Mode och garanterar inte att all datatrafik stoppas före samtycke. CMP, taggar, triggers och tester i GTM återstår.

## Så slutför du i Google Tag Manager

1. Öppna Passiton → Admin → Container Settings → **Enable consent overview**.
2. Skapa ett konto på https://www.cookiebot.com/ och registrera `passiton.nu` och `www.passiton.nu` om båda används. Skaffa ett **Domain Group ID** (ett UUID). Detta ID finns **inte** i de skärmbilder som använts för kodinstallationen.
3. I GTM: Templates → Search Gallery → installera **Cookiebot CMP**. Skapa sedan en ny tagg med ditt Cookiebot ID. Välj **Consent Initialization – All Pages** som trigger. Ange globalt standardvärde **denied** för frivilliga kategorier. Aktivera Google Consent Mode v2.
4. Konfigurera ett tydligt svenskt samtyckesval (acceptera / avvisa / anpassa, lika enkla val) och en länk/funktion för att ändra beslutet. Säkerställ att kategorier, lagringstider och faktisk cookieanvändning beskrivs i policytexten.
5. I GTM: kontrollera om en **Google tag** med `G-P7F3T8541P` redan finns. Skapa den endast om den saknas. Lägg inte in ytterligare ett externt GA4-skript i HTML.
6. Välj strategi och testa:
   - **Advanced Consent Mode:** Google-taggar använder inbyggda consent checks och kan skicka cookieless pings även innan statistik-samtycke. Sätt inte rutinmässigt extra consent checks på Google-taggar, eftersom det kan ge oväntat beteende.
   - **Basic Consent Mode:** om ni vill förhindra **alla** GA4-anrop före statistik-samtycke ska Google Analytics-taggarna inte laddas/fyras förrän CMP:n signalerar att statistik är godkänt. Följ Cookiebots aktuella instruktioner för `cookie_consent_update` och triggers, och verifiera efter avvisning, godkännande, återkallande och omladdning. Det kräver mer än bara `denied` i koden.
7. Under **Preview / Tag Assistant**, verifiera samtyckesstatus, GTM-events, GA4 Realtime och nätverkstrafik innan **Submit/Publish**. Vid Basic Consent Mode: inga förfrågningar till Google Analytics före statistik-samtycke.
8. Granska externa script **utanför** GTM separat (bl.a. Supabase SDK och Google Fonts); Cookiebot-taggen i GTM blockerar dem inte automatiskt.

Referenser:
- https://support.cookiebot.com/hc/en-us/articles/360003793854-Google-Tag-Manager-deployment
- https://support.google.com/analytics/answer/10718549
- https://support.google.com/analytics/answer/12962079
- https://developers.google.com/tag-platform/security/guides/consent

## Egna dataLayer-events

Händelserna skickas till `dataLayer` oberoende av GA4; för GA4 måste du skapa **Custom Event triggers**, **Data Layer Variables** och **GA4 Event-taggar** i GTM. Använd samma eventnamn för triggers som i tabellen.

| Eventnamn | När? | Fält |
|---|---|---|
| `passiton_virtual_page_view` | Intern SPA-navigering | `page_title`, `page_path`, `page_location` |
| `passiton_view_listing` | Visa annons | `item_brand`, `item_category`, `listing_type` |
| `passiton_add_to_cart` | Lägg till i korg | `item_brand`, `item_category`, `listing_type` |
| `passiton_begin_demo_checkout` | Starta demo-kassa | `item_count` |
| `passiton_demo_order_complete` | Demoorder registrerad | `item_count` |
| `passiton_listing_submitted` | Inskickat till granskning | `item_brand`, `item_category`, `listing_type` |
| `passiton_signup_requested` | Supabase accepterar registreringsförsök (e-postbekräftelse kan återstå) | – |
| `passiton_login` | Lyckad formulärinloggning | – |
| `passiton_search` | Sökfält ändrat eller Enter-sökning | `search_length` (aldrig söktext) |

För SPA-vyer: skicka `page_view` från `passiton_virtual_page_view` med DLV-variabler för `page_title` och `page_location`. Den vanliga sidvisningen på första laddning kan hanteras av Google tag; undvik dubbla `page_view` på första sidladdningen. Säkerställ att triggern får samtycke innan den skickar något till GA4.

**Rapportera inte en demoorder som ett riktigt GA4 `purchase`.** Ingen intäkt finns i denna MVP. När riktiga betalningar aktiveras måste purchase-spårning verifieras mot betalningssystemets bekräftade order.

### Sekretess

Dataskiktet är avsiktligt utan namn, e-postadress, konto-ID, presentkortskoder, fotobevis, transaktions-ID, betaluppgifter eller söktermer. GA4 Enhanced Measurement och externa skript måste ändå granskas separat. Anpassa integritetspolicy/cookieinformation efter er **faktiska** behandling. Gör juridisk granskning före lansering.

### Lokal test

```bash
node tests/analytics.test.cjs
python -m http.server 8000
```

Öppna `http://localhost:8000/frontend/`, testa gränssnittet och granska dataLayer i webbläsaren:

```js
window.dataLayer.filter(x => x?.event?.startsWith('passiton_'))
```

Den lokala smoke-testen kontrollerar eventschema men kan **inte** verifiera en GTM- eller Cookiebot-konfiguration i ditt konto.
