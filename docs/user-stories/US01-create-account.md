# US01 — Skapa konto

## User story

**Som besökare vill jag kunna skapa ett konto för att kunna köpa och sälja presentkort.**

- **Krav-ID:** K01, K02, K03
- **Prioritet:** Must
- **Status:** Planerad / pågående

## Syfte

US01 är den första vertikala funktion som byggs i Passiton. Målet är att införa den minsta struktur som behövs för kontoskapande utan att samtidigt bygga framtida funktioner som hör till senare user stories.

## Kodområden

### Frontend

`frontend/js/features/account/`

Här placeras UI-logik och klientkod som hör till skapande av konto.

### Backend

`backend/src/features/accounts/`

Här placeras serverlogik och datalager som behövs för kontoskapande när backendimplementationen påbörjas.

## Kravspårbarhet

| Krav | Implementation | Status |
| --- | --- | --- |
| K01 | Specificeras när kravtexten finns i repot | Ej påbörjad |
| K02 | Specificeras när kravtexten finns i repot | Ej påbörjad |
| K03 | Specificeras när kravtexten finns i repot | Ej påbörjad |

Vi gissar inte innehållet i K01–K03. När kravspecifikationen läggs in uppdateras tabellen med konkreta acceptance criteria och hänvisningar till kod/tester.

## Definition of Done

US01 är klar först när:

- K01, K02 och K03 är implementerade.
- Kontoskapandet fungerar i den avsedda användarresan.
- Fel- och valideringsfall som anges i kraven hanteras.
- Relevanta tester finns.
- Dokumentationen och kravspårbarheten är uppdaterade.
