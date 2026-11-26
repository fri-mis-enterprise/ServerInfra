import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { and, eq, ne, or } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { User } from '../types';
import type { z } from 'zod';
import type { loginSchema, registerSchema } from '../validation/auth';
import { getDb } from './db';
import { auditLogs, departments, userRoles, users } from './db/schema';

export type AuthContext = { user: number; roles: string[] };

type Db = ReturnType<typeof getDb>;
type LoginInput = z.infer<typeof loginSchema>;
type RegisterInput = z.infer<typeof registerSchema>;

export type UpdateProfileInput = {
  first_name?: string;
  last_name?: string;
  email?: string;
  username?: string;
  password?: string;
  message_notifications?: boolean;
};

type UserRow = typeof users.$inferSelect;
type DepartmentRow = typeof departments.$inferSelect;

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

function toDto(row: UserRow, roles: string[], departmentRow: DepartmentRow | null): User {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    username: row.username,
    position: row.position ?? undefined,
    message_notifications: row.message_notifications,
    is_active: row.is_active,
    last_active: row.last_active?.toISOString(),
    created_at: row.created_at?.toISOString(),
    updated_at: row.updated_at?.toISOString(),
    department_id: row.department_id ?? undefined,
    department: departmentRow
      ? {
          id: departmentRow.id,
          name: departmentRow.name,
          description: departmentRow.description ?? undefined,
          is_active: departmentRow.is_active,
        }
      : undefined,
    roles,
  };
}

function loadRoles(db: Db, userId: number): string[] {
  return db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.user_id, userId))
    .all()
    .map((r) => r.role);
}

function loadDepartment(db: Db, departmentId: number | null | undefined): DepartmentRow | null {
  if (!departmentId) return null;
  return db.select().from(departments).where(eq(departments.id, departmentId)).get() ?? null;
}

function insertAudit(
  db: Db,
  performedById: number | null,
  action: string,
  oldValue: string | null,
  newValue: string | null,
  notes?: string,
) {
  db.insert(auditLogs)
    .values({
      ticket_id: null,
      performed_by_id: performedById,
      action,
      old_value: oldValue,
      new_value: newValue,
      notes: notes ?? null,
      created_at: new Date(),
    })
    .run();
}

async function signToken(sub: string, roles: string[], expiresInSeconds: number): Promise<string> {
  return await new SignJWT({ sub, roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secretKey());
}

function isUniqueError(err: unknown): boolean {
  while (err instanceof Error) {
    if (err.message.includes('UNIQUE constraint failed')) return true;
    err = err.cause;
  }
  return false;
}

type Resolved =
  | { ok: true; row: UserRow; roles: string[]; departmentRow: DepartmentRow | null }
  | { ok: false; reason: 'unauthorized' | 'inactive' };

async function resolveSession(): Promise<Resolved> {
  const event = getRequestEvent();
  const token = event.cookies.get('auth_cookie');
  if (!token) return { ok: false, reason: 'unauthorized' };

  let payload;
  try {
    payload = (await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })).payload;
  } catch {
    return { ok: false, reason: 'unauthorized' };
  }

  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp <= 0) {
    return { ok: false, reason: 'unauthorized' };
  }
  const sub = payload.sub;
  if (!sub) return { ok: false, reason: 'unauthorized' };
  const userId = Number(sub);
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, reason: 'unauthorized' };

  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) return { ok: false, reason: 'unauthorized' };
  if (!row.is_active) return { ok: false, reason: 'inactive' };

  const roles = loadRoles(db, userId);
  const departmentRow = loadDepartment(db, row.department_id);

  // Use the stored timestamp so last-active tracking does not grow an in-memory user cache.
  if (!row.last_active || Date.now() - row.last_active.getTime() > 60_000) {
    const now = new Date();
    db.update(users).set({ last_active: now }).where(eq(users.id, userId)).run();
    row.last_active = now;
  }

  return { ok: true, row, roles, departmentRow };
}

export async function currentSession(): Promise<User | null> {
  const resolved = await resolveSession();
  if (!resolved.ok) return null;
  return toDto(resolved.row, resolved.roles, resolved.departmentRow);
}

export async function requireAuth(requiredRoles?: string[]): Promise<AuthContext> {
  const resolved = await resolveSession();
  if (!resolved.ok) {
    if (resolved.reason === 'inactive') throw error(403, 'Account is inactive');
    throw error(401, 'Unauthorized');
  }
  if (requiredRoles?.length && !requiredRoles.some((r) => resolved.roles.includes(r))) {
    throw error(403, 'Forbidden');
  }
  return { user: resolved.row.id, roles: resolved.roles };
}

export async function loginUser(input: LoginInput): Promise<{ message: string; user: User }> {
  const { username, password } = input;
  const db = getDb();
  const event = getRequestEvent();

  const row = db.select().from(users).where(eq(users.username, username)).get();
  if (!row) {
    insertAudit(db, null, 'user_login_failed', null, username, 'User not found');
    throw error(404, 'User not found');
  }
  if (!row.is_active) {
    insertAudit(db, row.id, 'user_login_failed', null, username, 'Account is inactive');
    throw error(403, 'Account is inactive. Please contact your administrator.');
  }

  const isValid = await Bun.password.verify(password, row.password);
  if (!isValid) {
    insertAudit(db, row.id, 'user_login_failed', null, username, 'Invalid password');
    throw error(401, 'Invalid credentials');
  }

  const roles = loadRoles(db, row.id);
  const departmentRow = loadDepartment(db, row.department_id);
  const token = await signToken(row.id.toString(), roles, 60 * 60 * 24 * 7);

  event.cookies.set('auth_cookie', token, {
    path: '/',
    httpOnly: true,
    secure: event.url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  insertAudit(db, row.id, 'user_login', null, username, `Roles: ${roles.join(', ')}`);
  return { message: 'Login Success', user: toDto(row, roles, departmentRow) };
}

export async function registerUser(
  input: RegisterInput,
): Promise<{ message: string; user: User }> {
  const db = getDb();

  if (input.department_id !== undefined && input.department_id !== null) {
    const dept = loadDepartment(db, input.department_id);
    if (!dept || !dept.is_active) throw error(400, 'Invalid department');
  }

  const existing = db
    .select()
    .from(users)
    .where(or(eq(users.username, input.username), eq(users.email, input.email)))
    .get();
  if (existing) throw error(409, 'User already exists');

  const hashedPassword = await Bun.password.hash(input.password);

  let created: UserRow | undefined;
  try {
    db.transaction((tx) => {
      const now = new Date();
      const inserted = tx
        .insert(users)
        .values({
          username: input.username,
          password: hashedPassword,
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email,
          position: input.position ?? null,
          department_id: input.department_id ?? null,
          created_at: now,
          updated_at: now,
        })
        .returning()
        .get();
      if (!inserted) throw new Error('Failed to create user');
      created = inserted;
      tx.insert(userRoles).values({ user_id: inserted.id, role: 'user', assigned_at: now }).run();
      tx.insert(auditLogs)
        .values({
          ticket_id: null,
          performed_by_id: inserted.id,
          action: 'user_registered',
          old_value: null,
          new_value: input.username,
          notes: `Email: ${input.email}`,
          created_at: now,
        })
        .run();
    });
  } catch (err) {
    if (isUniqueError(err)) throw error(409, 'User already exists');
    throw err;
  }

  const newUser = created as UserRow;
  const roles = loadRoles(db, newUser.id);
  const departmentRow = loadDepartment(db, newUser.department_id);
  return { message: 'Register Success', user: toDto(newUser, roles, departmentRow) };
}

export async function logoutUser(): Promise<{ message: string }> {
  const event = getRequestEvent();
  const session = await currentSession();

  event.cookies.set('auth_cookie', '', {
    path: '/',
    httpOnly: true,
    secure: event.url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 0,
  });

  if (session) {
    insertAudit(getDb(), session.id, 'user_logout', null, null);
  }
  return { message: 'Logout Success' };
}

export async function updateProfile(input: UpdateProfileInput): Promise<User> {
  const { user: userId } = await requireAuth();
  const db = getDb();

  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) throw error(404, 'User not found');

  // Hash outside the transaction (never inside it).
  const hashedPassword = input.password !== undefined ? await Bun.password.hash(input.password) : undefined;

  if (input.email !== undefined || input.username !== undefined) {
    const conditions = [];
    if (input.email !== undefined) conditions.push(eq(users.email, input.email));
    if (input.username !== undefined) conditions.push(eq(users.username, input.username));
    const conflict = db
      .select()
      .from(users)
      .where(and(ne(users.id, userId), or(...conditions)))
      .get();
    if (conflict) throw error(409, 'Username or Email already taken');
  }

  const updateData: Partial<UserRow> = {};
  if (input.first_name !== undefined) updateData.first_name = input.first_name;
  if (input.last_name !== undefined) updateData.last_name = input.last_name;
  if (input.email !== undefined) updateData.email = input.email;
  if (input.username !== undefined) updateData.username = input.username;
  if (input.message_notifications !== undefined)
    updateData.message_notifications = input.message_notifications;
  if (hashedPassword !== undefined) updateData.password = hashedPassword;

  const updatedKeys = Object.keys(updateData);
  if (updatedKeys.length === 0) throw error(400, 'No fields to update');

  let updated: UserRow | undefined;
  try {
    db.transaction((tx) => {
      const row = tx
        .update(users)
        .set({ ...updateData, updated_at: new Date() })
        .where(eq(users.id, userId))
        .returning()
        .get();
      if (!row) throw new Error('Failed to update user');
      updated = row;
      tx.insert(auditLogs)
        .values({
          ticket_id: null,
          performed_by_id: userId,
          action: 'user_profile_updated',
          old_value: null,
          new_value: null,
          notes: `Updated: ${updatedKeys.join(', ')}`,
          created_at: new Date(),
        })
        .run();
    });
  } catch (err) {
    if (isUniqueError(err)) throw error(409, 'Username or Email already taken');
    throw err;
  }

  const updatedUser = updated as UserRow;
  const roles = loadRoles(db, userId);
  const departmentRow = loadDepartment(db, updatedUser.department_id);
  return toDto(updatedUser, roles, departmentRow);
}
