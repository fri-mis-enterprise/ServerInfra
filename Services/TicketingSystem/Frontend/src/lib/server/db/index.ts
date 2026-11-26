import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

export function openDatabase(url: string) {
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL must be a local SQLite file: URL');
  const sqlite = new Database(url.slice(5), { create: false });
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return drizzle(sqlite);
}

let database: ReturnType<typeof openDatabase> | undefined;
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return database ??= openDatabase(url);
}
