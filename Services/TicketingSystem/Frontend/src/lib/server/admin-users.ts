import { error } from "@sveltejs/kit";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { z } from "zod";
import type { AuthContext } from "./auth";
import type { getDb } from "./db";
import { auditLogs, departments, userRoles, users } from "./db/schema";
import { sqliteDateMillis } from "./db/date";
import { loadUser } from "./ticket-reads";
import type {
  adminUserListSchema,
  createUserSchema,
  updateUserDataSchema,
} from "../validation/admin";
type Db = ReturnType<typeof getDb>;
type Reader = Pick<Db, "select">;
function admin(auth: AuthContext) {
  if (!auth.roles.includes("admin"))
    error(403, "Administrator access required");
}
function requireUser(db: Reader, id: number) {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) error(404, "User not found");
  return row;
}
function department(db: Reader, id?: number | null) {
  if (
    id != null &&
    !db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, id))
      .get()
  )
    error(400, "Department not found");
}
function conflict(
  db: Reader,
  input: { username?: string; email?: string },
  id?: number,
) {
  const predicates = [
    input.username ? eq(users.username, input.username) : undefined,
    input.email ? eq(users.email, input.email) : undefined,
  ].filter((value): value is SQL => value !== undefined);
  if (
    predicates.length &&
    db
      .select({ id: users.id })
      .from(users)
      .where(and(id ? ne(users.id, id) : undefined, or(...predicates)))
      .get()
  )
    error(409, "Username or email already taken");
}
function uniqueError(err: unknown): never {
  let cause = err;
  while (cause instanceof Error) {
    if (cause.message.includes("UNIQUE constraint failed"))
      error(409, "Username, email or role already exists");
    cause = cause.cause;
  }
  throw err;
}
function audit(
  db: Pick<Db, "insert">,
  auth: AuthContext,
  action: string,
  id: number,
  notes?: string,
) {
  db.insert(auditLogs)
    .values({
      performed_by_id: auth.user,
      action,
      new_value: String(id),
      notes,
    })
    .run();
}
function protectLastAdmin(db: Reader, id: number) {
  const target = requireUser(db, id);
  const hasAdmin = db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.user_id, id), eq(userRoles.role, "admin")))
    .get();
  if (!target.is_active || !hasAdmin) return;
  const others = db
    .select({ total: count() })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.user_id, users.id))
    .where(
      and(
        eq(users.is_active, true),
        eq(userRoles.role, "admin"),
        ne(users.id, id),
      ),
    )
    .get()!.total;
  if (!others) error(409, "Cannot remove the last active administrator");
}
export function listAdminUsers(
  db: Db,
  auth: AuthContext,
  input: z.output<typeof adminUserListSchema>,
) {
  admin(auth);
  const conditions: (SQL | undefined)[] = [];
  if (input.search)
    conditions.push(
      or(
        ...[users.first_name, users.last_name, users.username, users.email].map(
          (column) => sql`instr(lower(${column}),lower(${input.search})) > 0`,
        ),
      ),
    );
  if (input.role)
    conditions.push(
      exists(
        db
          .select({ id: userRoles.id })
          .from(userRoles)
          .where(
            and(
              eq(userRoles.user_id, users.id),
              eq(userRoles.role, input.role),
            ),
          ),
      ),
    );
  if (input.department_id)
    conditions.push(eq(users.department_id, input.department_id));
  if (input.is_active !== undefined)
    conditions.push(eq(users.is_active, input.is_active === "true"));
  const where = and(...conditions),
    sort =
      input.sort === "created_at"
        ? sqliteDateMillis(users.created_at)
        : users[input.sort],
    order = input.order === "asc" ? asc : desc;
  const ids = db
    .select({ id: users.id })
    .from(users)
    .where(where)
    .orderBy(order(sort), order(users.id))
    .limit(input.limit)
    .offset((input.page - 1) * input.limit)
    .all();
  const total = db.select({ total: count() }).from(users).where(where).get()!
    .total;
  return {
    data: ids.map((row) => loadUser(db, row.id)!),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.ceil(total / input.limit),
    },
  };
}
export function readAdminUser(db: Db, auth: AuthContext, id: number) {
  admin(auth);
  requireUser(db, id);
  return loadUser(db, id)!;
}
export async function createAdminUser(
  db: Db,
  auth: AuthContext,
  input: z.output<typeof createUserSchema>,
) {
  admin(auth);
  department(db, input.department_id);
  conflict(db, input);
  const password = await Bun.password.hash(input.password);
  try {
    return db.transaction((tx) => {
      conflict(tx, input);
      const row = tx
        .insert(users)
        .values({ ...input, password })
        .returning()
        .get()!;
      tx.insert(userRoles).values({ user_id: row.id, role: "user" }).run();
      audit(tx, auth, "user_created", row.id);
      return loadUser(tx, row.id)!;
    });
  } catch (err) {
    uniqueError(err);
  }
}
export async function updateAdminUser(
  db: Db,
  auth: AuthContext,
  id: number,
  input: z.output<typeof updateUserDataSchema>,
) {
  admin(auth);
  requireUser(db, id);
  department(db, input.department_id);
  conflict(db, input, id);
  const password =
    input.password === undefined
      ? undefined
      : await Bun.password.hash(input.password);
  try {
    return db.transaction((tx) => {
      if (input.is_active === false) protectLastAdmin(tx, id);
      conflict(tx, input, id);
      tx.update(users)
        .set({ ...input, password })
        .where(eq(users.id, id))
        .run();
      audit(tx, auth, "user_updated", id);
      return loadUser(tx, id)!;
    });
  } catch (err) {
    uniqueError(err);
  }
}
export function deactivateAdminUser(db: Db, auth: AuthContext, id: number) {
  admin(auth);
  return db.transaction((tx) => {
    protectLastAdmin(tx, id);
    tx.update(users).set({ is_active: false }).where(eq(users.id, id)).run();
    audit(tx, auth, "user_deactivated", id);
    return { success: true };
  });
}
export function assignUserRole(
  db: Db,
  auth: AuthContext,
  id: number,
  role: string,
) {
  admin(auth);
  requireUser(db, id);
  try {
    return db.transaction((tx) => {
      const row = tx
        .insert(userRoles)
        .values({ user_id: id, role })
        .returning()
        .get()!;
      audit(tx, auth, "user_role_added", id, role);
      return { ...row, assigned_at: row.assigned_at.toISOString() };
    });
  } catch (err) {
    uniqueError(err);
  }
}
export function removeUserRole(
  db: Db,
  auth: AuthContext,
  id: number,
  role: string,
) {
  admin(auth);
  return db.transaction((tx) => {
    requireUser(tx, id);
    if (role === "admin") protectLastAdmin(tx, id);
    const row = tx
      .delete(userRoles)
      .where(and(eq(userRoles.user_id, id), eq(userRoles.role, role)))
      .returning()
      .get();
    if (!row) error(404, "Role not found for this user");
    audit(tx, auth, "user_role_removed", id, role);
    return { success: true };
  });
}
