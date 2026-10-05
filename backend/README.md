# Passiton backend

Node.js med ES-moduler, inbyggt HTTP-stöd och Nodes inbyggda SQLite-stöd.
Kräver Node.js 22.5 eller senare. Kör `npm install` och sedan `npm start`.
`npm run dev` startar med Nodes watch-läge. Servern lyssnar på
`127.0.0.1:3000`; `HOST`, `PORT` och `DATABASE_PATH` kan anges i miljön.

## US01 – registrering

`POST /api/accounts/register` tar emot `email`, `password` och
`passwordConfirmation`. E-post normaliseras till små bokstäver och valideras på
servern. Lösenord måste vara 8–128 tecken och innehålla bokstav och siffra.

Konton sparas i `database/passiton.sqlite`. Lösenord hashas med `crypto.scrypt`
och endast hash + salt lagras. Varken lösenord eller hash returneras i API-svar.
Databasens unika constraint och `INSERT OR IGNORE` skyddar mot dubbla konton även
om registreringsanrop når servern samtidigt.

`GET /api/health` svarar 200. Övriga funktionsområden är fortfarande stommar
och svarar 501.

Använd inte riktiga personuppgifter, presentkortskoder eller betalningar i skol-MVP:n.
