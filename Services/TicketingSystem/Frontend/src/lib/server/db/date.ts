import { customType } from 'drizzle-orm/sqlite-core';
import { sql, type SQLWrapper } from 'drizzle-orm';

export const sqliteNow = sql`(strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))`;

// Compare all historic encodings chronologically, including integer epoch milliseconds.
export const sqliteDateMillis = (column: SQLWrapper) => sql<number>`CASE WHEN typeof(${column}) IN ('integer', 'real') THEN ${column} ELSE round((julianday(${column}) - 2440587.5) * 86400000) END`;

// Prisma/libsql writes ISO text; SQLite defaults and older clients can write UTC text or epoch milliseconds.
export const sqliteDate = customType<{ data: Date; driverData: string | number }>({
  dataType: () => 'DATETIME',
  toDriver: value => value.toISOString().replace('Z', '+00:00'),
  fromDriver(value) {
    const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid SQLite date');
    return date;
  },
});
