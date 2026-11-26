import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { eq, getTableName, SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { getTableConfig, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

let sqlite: Database;
beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of ['20260529061222_init', '20260529081903_init']) {
    sqlite.exec(readFileSync(new URL(`../../../../test/fixtures/legacy/${name}.sql`, import.meta.url), 'utf8'));
  }
});
afterEach(() => sqlite.close());

test('all table columns, defaults, indexes and foreign keys match the existing migrations', () => {
  const tables = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'").all();
  expect(tables.map(table => table.name).sort()).toEqual(Object.values(schema).map(getTableName).sort());
  const dialect = new SQLiteSyncDialect();
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const columns = sqlite.query<{ name: string; notnull: number; pk: number; dflt_value: string | null }, []>(`PRAGMA table_info("${config.name}")`).all();
    expect(config.columns.map(column => column.name)).toEqual(columns.map(column => column.name));
    for (const [i, column] of config.columns.entries()) {
      expect(column.notNull).toBe(!!columns[i].notnull);
      expect(column.primary).toBe(!!columns[i].pk);
      const expectedDefault = columns[i].dflt_value;
      const actualDefault = column.default;
      if (actualDefault instanceof SQL) {
        expect(expectedDefault).toBe('CURRENT_TIMESTAMP');
        expect(dialect.sqlToQuery(actualDefault).sql).toContain("strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')");
      }
      else if (typeof actualDefault === 'boolean') expect(expectedDefault).toBe(String(actualDefault));
      else if (typeof actualDefault === 'string') expect(expectedDefault).toBe(`'${actualDefault}'`);
      else expect(expectedDefault).toBe(actualDefault === undefined ? null : String(actualDefault));
    }
    const indexes = sqlite.query<{ name: string; unique: number }, []>(`PRAGMA index_list("${config.name}")`).all();
    expect(config.indexes.map(index => index.config.name).sort()).toEqual(indexes.map(index => index.name).sort());
    for (const index of config.indexes) {
      const actual = indexes.find(item => item.name === index.config.name)!;
      expect(index.config.unique).toBe(!!actual.unique);
      const columns = sqlite.query<{ name: string }, []>(`PRAGMA index_info("${actual.name}")`).all();
      expect(index.config.columns.map(column => 'name' in column ? column.name : undefined)).toEqual(columns.map(column => column.name));
    }
    const expectedKeys = sqlite.query<{ from: string; table: string; to: string; on_delete: string; on_update: string }, []>(`PRAGMA foreign_key_list("${config.name}")`).all()
      .map(({ from, table, to, on_delete, on_update }) => ({ from, table, to, on_delete, on_update }));
    const actualKeys = config.foreignKeys.map(key => {
      const ref = key.reference();
      return { from: ref.columns[0].name, table: getTableName(ref.foreignTable), to: ref.foreignColumns[0].name, on_delete: (key.onDelete ?? 'no action').toUpperCase(), on_update: (key.onUpdate ?? 'no action').toUpperCase() };
    });
    expect(actualKeys.sort((a, b) => a.from.localeCompare(b.from))).toEqual(expectedKeys.sort((a, b) => a.from.localeCompare(b.from)));
  }
});

test('reads existing date encodings as UTC and writes the Prisma/libsql ISO format', () => {
  const db = drizzle(sqlite);
  const date = new Date('2026-11-05T04:05:06.789Z');
  const [user] = db.insert(schema.users).values({ first_name: 'Test', last_name: 'User', username: 'test', email: 'test@example.com', password: 'fixture', created_at: date }).returning().all();
  expect(user.created_at.toISOString()).toBe(date.toISOString());
  expect(sqlite.query<{ created_at: string }, []>('SELECT created_at FROM User').get()!.created_at).toBe('2026-11-05T04:05:06.789+00:00');
  for (const value of ['2026-11-05 04:05:06', '2026-11-05T04:05:06+00:00', 1793851506000]) {
    sqlite.query('UPDATE User SET last_active = ?').run(value);
    expect(db.select().from(schema.users).get()!.last_active!.toISOString()).toBe('2026-11-05T04:05:06.000Z');
  }
  expect(user.is_active).toBe(true);
  expect(user.message_notifications).toBe(true);
  expect(user.updated_at).toBeInstanceOf(Date);
  db.update(schema.users).set({ is_active: false, updated_at: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, user.id)).run();
  db.update(schema.users).set({ position: 'Updated' }).where(eq(schema.users.id, user.id)).run();
  expect(db.select().from(schema.users).get()!.updated_at.getUTCFullYear()).toBeGreaterThan(2000);
  expect(db.select().from(schema.users).get()!.is_active).toBe(false);
  sqlite.query('UPDATE User SET last_active = ?').run('not a date');
  expect(() => db.select().from(schema.users).all()).toThrow('Invalid SQLite date');
});

test('preserves uniqueness, cascading deletes and transaction rollback', () => {
  const db = drizzle(sqlite);
  const [user] = db.insert(schema.users).values({ first_name: 'Test', last_name: 'User', username: 'test', email: 'test@example.com', password: 'fixture' }).returning().all();
  db.insert(schema.userRoles).values({ user_id: user.id, role: 'user' }).run();
  expect(() => db.insert(schema.userRoles).values({ user_id: user.id, role: 'user' }).run()).toThrow();
  expect(() => db.transaction(tx => {
    tx.insert(schema.departments).values({ name: 'Rollback' }).run();
    throw new Error('abort');
  })).toThrow('abort');
  expect(db.select().from(schema.departments).all()).toEqual([]);
  db.insert(schema.pushSubscriptions).values({ user_id: user.id, endpoint: 'https://example.com/push', p256dh: 'fixture', auth: 'fixture' }).run();
  expect(() => db.delete(schema.users).where(eq(schema.users.id, user.id)).run()).toThrow();
  db.delete(schema.userRoles).where(eq(schema.userRoles.user_id, user.id)).run();
  db.delete(schema.users).where(eq(schema.users.id, user.id)).run();
  expect(db.select().from(schema.pushSubscriptions).all()).toEqual([]);
});
