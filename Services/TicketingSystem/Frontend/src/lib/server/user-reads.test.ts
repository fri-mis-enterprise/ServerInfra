import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrateDatabase } from './db/migrate';
import type { getDb } from './db';
import { departments, userRoles, users } from './db/schema';
import { readActiveUsers, readApprovers, readAssignees, readUserDirectory } from './user-reads';
import { assigneeFilterSchema } from '../validation/users';

let sqlite: Database;
let db: ReturnType<typeof getDb>;
beforeEach(() => { sqlite = new Database(':memory:'); migrateDatabase(sqlite); db = drizzle(sqlite); });
afterEach(() => sqlite.close());

test('directory exposes only public contact fields, omits inactive users and sorts names', () => {
  db.insert(users).values([
    { first_name: 'Zed', last_name: 'Zed', username: 'zed', email: 'private1@example.com', password: 'secret' },
    { first_name: 'Ann', last_name: 'Able', username: 'ann', email: 'private2@example.com', password: 'secret' },
    { first_name: 'Inactive', last_name: 'Able', username: 'inactive', email: 'private3@example.com', password: 'secret', is_active: false },
  ]).run();
  const contacts = readUserDirectory(db);
  expect(contacts.map(row => row.username)).toEqual(['ann', 'zed']);
  expect(Object.keys(contacts[0]).sort()).toEqual(['id', 'first_name', 'last_name', 'username', 'position', 'last_active'].sort());
});

test('active contacts exclude self by identity rather than removing the newest other user', () => {
  const now = new Date('2026-11-05T09:00:00Z');
  const rows = db.insert(users).values([
    { first_name: 'Self', last_name: 'Test', username: 'self', email: 'self@example.com', password: 'secret', last_active: new Date(now.getTime() - 60_000) },
    { first_name: 'Recent', last_name: 'Test', username: 'recent', email: 'recent@example.com', password: 'secret', last_active: now },
    { first_name: 'Old', last_name: 'Test', username: 'old', email: 'old@example.com', password: 'secret', last_active: new Date(now.getTime() - 300_001) },
    { first_name: 'Inactive', last_name: 'Test', username: 'inactive', email: 'inactive@example.com', password: 'secret', last_active: now, is_active: false },
  ]).returning().all();
  sqlite.query('UPDATE User SET last_active = ? WHERE id = ?').run(now.getTime(), rows[1].id);
  expect(readActiveUsers(db, { user: rows[0].id, roles: ['user'] }, now).map(row => row.username)).toEqual(['recent']);
});

test('assignees preserve department filtering and fallback, approvers require active role holders', () => {
  const depts = db.insert(departments).values([{ name: 'One' }, { name: 'Two' }]).returning().all();
  const people = db.insert(users).values([
    { first_name: 'MIS', last_name: 'One', username: 'mis', email: 'mis@example.com', password: 'secret', department_id: depts[0].id },
    { first_name: 'Approver', last_name: 'One', username: 'approver', email: 'approver@example.com', password: 'secret', department_id: depts[1].id },
    { first_name: 'Inactive', last_name: 'One', username: 'inactive', email: 'inactive@example.com', password: 'secret', is_active: false },
  ]).returning().all();
  db.insert(userRoles).values([{ user_id: people[0].id, role: 'mis' }, { user_id: people[1].id, role: 'approver' }, { user_id: people[2].id, role: 'approver' }]).run();
  expect(readAssignees(db, { department_id: depts[0].id }).map(row => row.id)).toEqual([people[0].id]);
  expect(readAssignees(db, { department_id: depts[1].id }).map(row => row.id)).toEqual([people[0].id]);
  const approvers = readApprovers(db);
  expect(approvers.map(row => row.id)).toEqual([people[1].id]);
  expect(approvers[0].roles).toEqual(['approver']);
  expect(approvers[0]).not.toHaveProperty('password');
  expect(assigneeFilterSchema.safeParse({ department_id: -1 }).success).toBe(false);
});
