# Backend

Backenden byggs stegvis utifrån Passitons user stories.

Vi skapar inte routes, services eller databastabeller för framtida funktioner innan de behövs. Varje ny user story får den minsta backendstruktur som krävs för att uppfylla sina krav.

## Aktuellt fokus

**US01 — Skapa konto**

- Krav: K01, K02, K03
- Kodområde: `backend/src/features/accounts/`
- Specifikation: `docs/user-stories/US01-create-account.md`

Backendteknik och databas väljs/implementeras när US01:s konkreta krav kräver det.

## Kommande funktioner

Senare user stories, exempelvis identitetsverifiering, annonser och köp, får egna featureområden först när utvecklingen når dem.

Frontend använder tills vidare demodata och `localStorage` för den befintliga demo-MVP:n.
