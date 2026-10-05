# Lagring

US01 använder SQLite via Nodes inbyggda `node:sqlite`. Databasen skapas automatiskt
som `passiton.sqlite` i denna mapp när backend startas. Filen versionshanteras inte.

Tabellen `users` innehåller:
- `id`
- normaliserad och unik `email`
- `password_hash` (scrypt med unik salt)
- `created_at`

Övriga lagringsbehov för annonser, verifiering, order och betalningar modelleras när
respektive user story implementeras.
