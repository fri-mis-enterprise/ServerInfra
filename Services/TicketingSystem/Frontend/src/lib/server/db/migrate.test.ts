import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrateDatabase } from './migrate';
import { users, tickets } from './schema';

function legacyDatabase() {
  const sqlite = new Database(':memory:');
  for (const name of ['20260529061222_init', '20260529081903_init']) {
    sqlite.exec(readFileSync(new URL(`../../../../test/fixtures/legacy/${name}.sql`, import.meta.url), 'utf8'));
  }
  return sqlite;
}

test('initializes a fresh database and can rerun without resetting data', () => {
  using sqlite = new Database(':memory:');
  migrateDatabase(sqlite);
  const db = drizzle(sqlite);
  const user = db.insert(users).values({ first_name: 'Fresh', last_name: 'User', username: 'fresh', email: 'fresh@example.com', password: 'fixture' }).returning().get()!;
  migrateDatabase(sqlite);
  expect(db.select().from(users).get()!.id).toBe(user.id);
  expect(sqlite.query<{ count: number }, []>('SELECT count(*) AS count FROM __drizzle_migrations').get()!.count).toBe(1);
});

test('adopts the existing Prisma schema while preserving rows and migration history', () => {
  using sqlite = legacyDatabase();
  sqlite.exec("CREATE TABLE _prisma_migrations (id TEXT); INSERT INTO _prisma_migrations VALUES ('keep-me');");
  const db = drizzle(sqlite);
  db.insert(users).values({ first_name: 'Real', last_name: 'User', username: 'existing', email: 'existing@example.com', password: 'keep-this-hash' }).run();
  const before = sqlite.query('SELECT * FROM User').all();
  migrateDatabase(sqlite);
  migrateDatabase(sqlite);
  expect(sqlite.query('SELECT * FROM User').all()).toEqual(before);
  expect(sqlite.query<{ id: string }, []>('SELECT id FROM _prisma_migrations').get()!.id).toBe('keep-me');
  expect(sqlite.query<{ count: number }, []>('SELECT count(*) AS count FROM __drizzle_migrations').get()!.count).toBe(1);
});

test('rejects partial or incompatible databases without writing baseline history', () => {
  using partial = new Database(':memory:');
  partial.exec('CREATE TABLE User (id INTEGER PRIMARY KEY)');
  expect(() => migrateDatabase(partial)).toThrow('Cannot adopt database');
  expect(partial.query("SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'").get()).toBeNull();
  using incompatible = legacyDatabase();
  incompatible.exec('DROP INDEX Ticket_due_date_idx');
  expect(() => migrateDatabase(incompatible)).toThrow('incompatible schema for Ticket');
  expect(incompatible.query("SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'").get()).toBeNull();
});

test('rejects changed or unknown migration history', () => {
  using sqlite = new Database(':memory:');
  migrateDatabase(sqlite);
  sqlite.exec("UPDATE __drizzle_migrations SET hash = 'tampered'");
  expect(() => migrateDatabase(sqlite)).toThrow('migration history does not match');
});

test('new dates sort consistently with existing ISO timestamps', () => {
  using sqlite = legacyDatabase();
  migrateDatabase(sqlite);
  const db = drizzle(sqlite);
  const user = db.insert(users).values({ first_name: 'Sort', last_name: 'Test', username: 'sort', email: 'sort@example.com', password: 'fixture' }).returning().get()!;
  const older = new Date(Date.now() - 60_000);
  db.insert(tickets).values({ title: 'Older', description: 'Fixture', requester_id: user.id, created_at: older }).run();
  db.insert(tickets).values({ title: 'Newer', description: 'Fixture', requester_id: user.id }).run();
  const rows = sqlite.query<{ title: string; created_at: string }, []>('SELECT title, created_at FROM Ticket ORDER BY created_at DESC').all();
  expect(rows.map(row => row.title)).toEqual(['Newer', 'Older']);
  expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
});
