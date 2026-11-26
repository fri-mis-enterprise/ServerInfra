import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrateDatabase } from "./db/migrate";
import type { getDb } from "./db";
import { auditLogs, userRoles, users } from "./db/schema";
import {
  assignUserRole,
  createAdminUser,
  deactivateAdminUser,
  listAdminUsers,
  removeUserRole,
  updateAdminUser,
} from "./admin-users";
import {
  adminUserListSchema,
  createUserSchema,
  updateUserDataSchema,
  userRoleSchema,
} from "../validation/admin";
let sqlite: Database, db: ReturnType<typeof getDb>;
const admin = { user: 1, roles: ["admin"] },
  ordinary = { user: 2, roles: ["user"] };
function status(run: () => unknown, code: number) {
  try {
    run();
    throw new Error("Expected rejection");
  } catch (err) {
    expect(err).toMatchObject({ status: code });
  }
}
beforeEach(() => {
  sqlite = new Database(":memory:");
  migrateDatabase(sqlite);
  sqlite.exec("PRAGMA foreign_keys=ON");
  db = drizzle(sqlite);
  db.insert(users)
    .values({
      id: 1,
      first_name: "Admin",
      last_name: "Test",
      email: "admin@example.com",
      username: "admin",
      password: "hash",
    })
    .run();
  db.insert(userRoles).values({ user_id: 1, role: "admin" }).run();
});
afterEach(() => sqlite.close());
test("admin user writes hash passwords, keep safe DTOs and audit every mutation", async () => {
  const input = createUserSchema.parse({
    first_name: "New",
    last_name: "User",
    email: "new@example.com",
    username: "newuser",
    password: "password123",
  });
  const row = await createAdminUser(db, admin, input);
  expect(row).not.toHaveProperty("password");
  expect(row.roles).toEqual(["user"]);
  expect(
    await Bun.password.verify(
      "password123",
      db.select().from(users).all()[1].password,
    ),
  ).toBe(true);
  assignUserRole(db, admin, row.id, "mis");
  expect(
    listAdminUsers(
      db,
      admin,
      adminUserListSchema.parse({ role: "mis", page: "1" }),
    ).data[0].roles.sort(),
  ).toEqual(["mis", "user"]);
  const updated = await updateAdminUser(
    db,
    admin,
    row.id,
    updateUserDataSchema.parse({
      first_name: "Updated",
      password: "newpassword",
    }),
  );
  expect(updated.first_name).toBe("Updated");
  expect(
    await Bun.password.verify(
      "newpassword",
      db.select().from(users).all()[1].password,
    ),
  ).toBe(true);
  removeUserRole(db, admin, row.id, "mis");
  deactivateAdminUser(db, admin, row.id);
  expect(
    listAdminUsers(db, admin, adminUserListSchema.parse({ is_active: "false" }))
      .pagination.total,
  ).toBe(1);
  expect(db.select().from(auditLogs).all()).toHaveLength(5);
  await expect(createAdminUser(db, admin, input)).rejects.toMatchObject({
    status: 409,
  });
});
test("user administration blocks non-admin role changes and removal of last active admin", async () => {
  status(
    () => listAdminUsers(db, ordinary, adminUserListSchema.parse({})),
    403,
  );
  status(
    () => removeUserRole(db, { ...ordinary, roles: ["mis"] }, 1, "admin"),
    403,
  );
  status(() => removeUserRole(db, admin, 1, "admin"), 409);
  status(() => deactivateAdminUser(db, admin, 1), 409);
  await expect(
    updateAdminUser(db, admin, 1, { is_active: false }),
  ).rejects.toMatchObject({ status: 409 });
  expect(userRoleSchema.safeParse({ id: 1, role: "superuser" }).success).toBe(
    false,
  );
  expect(
    createUserSchema.safeParse({
      first_name: "X",
      last_name: "X",
      username: "xxx",
      email: "x@example.com",
      password: "password123",
      roles: ["admin"],
    }).success,
  ).toBe(false);
});
