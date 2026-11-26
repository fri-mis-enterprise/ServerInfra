import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateDatabase } from '../src/lib/server/db/migrate';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('file:')) throw new Error('DATABASE_URL must be a local SQLite file: URL');
const filename = url.slice(5);
mkdirSync(dirname(filename), { recursive: true });
const sqlite = new Database(filename, { create: true });
try {
  migrateDatabase(sqlite, process.env.MIGRATIONS_DIR || './drizzle');
  console.log('SQLite migrations complete');
} finally {
  sqlite.close();
}
