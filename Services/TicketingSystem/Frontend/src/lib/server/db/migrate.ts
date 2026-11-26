import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

type History = { hash: string; created_at: number };
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const hasTable = (db: Database, name: string) => !!db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

function describeTable(db: Database, table: string) {
  const columns = db.query<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }, []>(`PRAGMA table_info(${quote(table)})`).all();
  const keys = db.query<{ from: string; table: string; to: string; on_delete: string; on_update: string }, []>(`PRAGMA foreign_key_list(${quote(table)})`).all();
  const indexes = db.query<{ name: string; unique: number }, []>(`PRAGMA index_list(${quote(table)})`).all();
  return {
    columns: columns.map(({ name, type, notnull, pk, dflt_value }) => ({
      name, type: type.toUpperCase() === 'BOOLEAN' ? 'INTEGER' : type.toUpperCase(), notnull, pk,
      // Keep legacy SQL defaults intact; new Drizzle inserts use the equivalent ISO UTC expression.
      default: type.toUpperCase() === 'DATETIME' && (dflt_value === 'CURRENT_TIMESTAMP' || dflt_value?.includes("strftime('%Y-%m-%dT%H:%M:%f+00:00'"))
        ? 'UTC_NOW' : dflt_value,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    keys: keys.map(({ from, table, to, on_delete, on_update }) => ({ from, table, to, on_delete, on_update })).sort((a, b) => a.from.localeCompare(b.from)),
    indexes: indexes.map(({ name, unique }) => ({ name, unique, columns: db.query<{ name: string }, []>(`PRAGMA index_info(${quote(name)})`).all().map(column => column.name) })),
  };
}

export function migrateDatabase(sqlite: Database, migrationsFolder = './drizzle') {
  const migrations = readMigrationFiles({ migrationsFolder });
  const baseline = migrations[0];
  if (!baseline) throw new Error('The SQLite baseline migration is missing');
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  sqlite.transaction(() => {
    const applied = hasTable(sqlite, '__drizzle_migrations')
      ? sqlite.query<History, []>('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all() : [];
    if (applied.length) {
      for (const row of applied) {
        if (!migrations.some(migration => migration.hash === row.hash && migration.folderMillis === Number(row.created_at))) {
          throw new Error('Database migration history does not match this application version');
        }
      }
      if (!applied.some(row => row.hash === baseline.hash)) throw new Error('Database baseline is missing from migration history');
      return;
    }

    const tables = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('__drizzle_migrations', '_prisma_migrations')").all();
    if (!tables.length) return;

    const expected = new Database(':memory:');
    try {
      for (const statement of baseline.sql) expected.exec(statement);
      const expectedTables = expected.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      for (const { name } of expectedTables) {
        if (!hasTable(sqlite, name)) throw new Error(`Cannot adopt database: missing table ${name}`);
        const current = describeTable(sqlite, name);
        const required = describeTable(expected, name);
        if (JSON.stringify(current.columns) !== JSON.stringify(required.columns) || JSON.stringify(current.keys) !== JSON.stringify(required.keys)
          || required.indexes.some(index => !current.indexes.some(candidate => JSON.stringify(candidate) === JSON.stringify(index)))) {
          throw new Error(`Cannot adopt database: incompatible schema for ${name}`);
        }
      }
    } finally {
      expected.close();
    }

    sqlite.exec('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    sqlite.query('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(baseline.hash, baseline.folderMillis);
  }).immediate();

  migrate(drizzle(sqlite), { migrationsFolder });
}
