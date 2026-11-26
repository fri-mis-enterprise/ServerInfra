import './migrate';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import { auditLogs, users, userRoles } from '../src/lib/server/db/schema';

const input = z.object({ username: z.string().min(3), email: z.email(), password: z.string().min(12) }).parse({
  username: process.env.ADMIN_USERNAME || 'admin', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
});
const db = getDb();
try {
  if (db.select({ id: users.id }).from(users).where(or(eq(users.username, input.username), eq(users.email, input.email))).get()) throw new Error('Username or email already exists; no account was changed.');
  const password = await Bun.password.hash(input.password);
  db.transaction(tx => {
    const user = tx.insert(users).values({ ...input, password, first_name: 'Admin', last_name: 'User' }).returning().get()!;
    tx.insert(userRoles).values({ user_id: user.id, role: 'admin' }).run();
    tx.insert(auditLogs).values({ performed_by_id: user.id, action: 'administrator_created', new_value: input.username }).run();
  });
  console.log(`Administrator ${input.username} created.`);
} finally { db.$client.close(); }
