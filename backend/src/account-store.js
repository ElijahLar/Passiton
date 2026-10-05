import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const databaseDir = resolve(here, '../database');
mkdirSync(databaseDir, { recursive: true });

const databasePath = process.env.DATABASE_PATH || resolve(databaseDir, 'passiton.sqlite');
const db = new DatabaseSync(databasePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, email, password_hash, created_at)
  VALUES (?, ?, ?, ?)
`);

export function createUser({ id, email, passwordHash, createdAt }) {
  const result = insertUser.run(id, email, passwordHash, createdAt);
  if (result.changes !== 1) return null;
  return { id, email, createdAt };
}
