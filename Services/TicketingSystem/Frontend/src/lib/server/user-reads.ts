import { and, asc, desc, eq, exists, ne, sql } from 'drizzle-orm';
import type { User } from '../types';
import type { AuthContext } from './auth';
import type { getDb } from './db';
import { userRoles, users } from './db/schema';
import { sqliteDateMillis } from './db/date';

type Db = ReturnType<typeof getDb>;
type UserRow = typeof users.$inferSelect;
export type UserContact = Pick<User, 'id' | 'first_name' | 'last_name' | 'username' | 'position' | 'last_active'>;

const contactColumns = { id: users.id, first_name: users.first_name, last_name: users.last_name, username: users.username, position: users.position, last_active: users.last_active };
function contact(row: Pick<UserRow, keyof typeof contactColumns>): UserContact {
  return { ...row, position: row.position ?? undefined, last_active: row.last_active?.toISOString() };
}

export function readUserDirectory(db: Db): UserContact[] {
  return db.select(contactColumns).from(users).where(eq(users.is_active, true))
    .orderBy(asc(users.last_name), asc(users.first_name), asc(users.id)).all().map(contact);
}

export function readActiveUsers(db: Db, auth: AuthContext, now = new Date()): UserContact[] {
  return db.select(contactColumns).from(users).where(and(
    eq(users.is_active, true), ne(users.id, auth.user), sql`${sqliteDateMillis(users.last_active)} >= ${now.getTime() - 5 * 60 * 1000}`,
  )).orderBy(desc(sqliteDateMillis(users.last_active)), asc(users.id)).all().map(contact);
}

function usersWithRole(db: Db, role: string, departmentId?: number): User[] {
  const rows = db.select().from(users).where(and(eq(users.is_active, true),
    exists(db.select({ id: userRoles.id }).from(userRoles).where(and(eq(userRoles.user_id, users.id), eq(userRoles.role, role)))),
    departmentId === undefined ? undefined : eq(users.department_id, departmentId),
  )).orderBy(asc(users.last_name), asc(users.first_name), asc(users.id)).all();
  return rows.map(({ password: _password, ...row }) => ({
    ...row, position: row.position ?? undefined, department_id: row.department_id ?? undefined,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(), last_active: row.last_active?.toISOString(),
    roles: db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.user_id, row.id)).all().map(item => item.role),
  }));
}

export function readAssignees(db: Db, input: { department_id?: number }): User[] {
  const matches = usersWithRole(db, 'mis', input.department_id);
  return input.department_id !== undefined && matches.length === 0 ? usersWithRole(db, 'mis') : matches;
}

export function readApprovers(db: Db): User[] {
  return usersWithRole(db, 'approver');
}
