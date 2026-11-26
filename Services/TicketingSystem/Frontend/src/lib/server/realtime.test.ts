import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import type { getDb } from './db';
import { migrateDatabase } from './db/migrate';
import { tickets, userRoles, users } from './db/schema';
import { broadcaster, currentRoles, subscribeEvents } from './realtime';

let sqlite: Database, db: ReturnType<typeof getDb>;
let cleanup: (() => unknown)[];
beforeEach(() => {
  sqlite = new Database(':memory:'); migrateDatabase(sqlite); db = drizzle(sqlite); cleanup = [];
  db.insert(users).values(['owner', 'other', 'staff'].map(username => ({ username, email: `${username}@example.com`, first_name: username, last_name: 'Test', password: 'secret' }))).run();
  db.insert(userRoles).values([{ user_id: 1, role: 'user' }, { user_id: 2, role: 'user' }, { user_id: 3, role: 'mis' }]).run();
  db.insert(tickets).values({ title: 'Private', description: 'Description', requester_id: 1 }).run();
});
afterEach(() => { cleanup.forEach(fn => fn()); sqlite.close(); });
function listen(user: number) {
  const events: unknown[] = [], closed: boolean[] = [];
  cleanup.push(subscribeEvents({ db, user, expiresAt: Date.now() + 60_000, tickets: new Set([1]), send: event => events.push(event), close: () => closed.push(true) }));
  return { events, closed };
}
test('events enforce ticket access, internal-note privacy and user scopes', () => {
  const owner = listen(1), other = listen(2), staff = listen(3);
  broadcaster.ticketUpdated(1, { status: 'open' });
  expect(owner.events).toHaveLength(1); expect(other.events).toHaveLength(0); expect(staff.events).toHaveLength(1);
  broadcaster.internalNoteAdded(1, { content: 'Secret' });
  expect(owner.events).toHaveLength(1); expect(staff.events).toHaveLength(2);
  broadcaster.messageSent(2, { content: 'Personal' });
  expect(owner.events).toHaveLength(1); expect(other.events).toHaveLength(1); expect(staff.events).toHaveLength(2);
});
test('role revocation and inactive/expired sessions take effect before the next event', () => {
  const staff = listen(3);
  db.delete(userRoles).where(eq(userRoles.user_id, 3)).run();
  broadcaster.internalNoteAdded(1, { content: 'Secret' });
  expect(staff.events).toHaveLength(0);
  db.update(users).set({ is_active: false }).where(eq(users.id, 3)).run();
  broadcaster.notifyUser(3, { content: 'Private' });
  expect(staff.closed).toHaveLength(1); expect(staff.events).toHaveLength(0);
  expect(currentRoles(db, 1, Date.now() - 1)).toBeNull();
});

test('a disconnected client cannot fail a committed mutation or other deliveries', () => {
  const healthy = listen(1);
  const closed: boolean[] = [];
  cleanup.push(subscribeEvents({ db, user: 1, expiresAt: Date.now() + 60_000, tickets: new Set([1]), send: () => { throw new Error('Disconnected'); }, close: () => closed.push(true) }));
  expect(() => broadcaster.notifyUser(1, { id: 1 })).not.toThrow();
  expect(healthy.events).toHaveLength(1);
  expect(closed).toHaveLength(1);
  broadcaster.notifyUser(1, { id: 2 });
  expect(closed).toHaveLength(1);
});
