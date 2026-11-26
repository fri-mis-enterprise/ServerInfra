import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '../../lib/server/db';

export function GET() {
  getDb().get(sql`SELECT 1`);
  return json({ status: 'ok' });
}
