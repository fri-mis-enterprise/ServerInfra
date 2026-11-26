import { command, query } from "$app/server";
import { requireAuth } from "./server/auth";
import { getDb } from "./server/db";
import {
  assignUserRole,
  createAdminUser,
  deactivateAdminUser,
  listAdminUsers,
  readAdminUser,
  removeUserRole,
  updateAdminUser,
} from "./server/admin-users";
import {
  adminUserListSchema,
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  userRoleSchema,
} from "./validation/admin";
export const getAdminUsers = query(adminUserListSchema, async (input) =>
  listAdminUsers(getDb(), await requireAuth(["admin"]), input),
);
export const getAdminUser = query(userIdSchema, async (id) =>
  readAdminUser(getDb(), await requireAuth(["admin"]), id),
);
export const createUser = command(createUserSchema, async (input) =>
  createAdminUser(getDb(), await requireAuth(["admin"]), input),
);
export const updateUser = command(updateUserSchema, async ({ id, data }) =>
  updateAdminUser(getDb(), await requireAuth(["admin"]), id, data),
);
export const deactivateUser = command(userIdSchema, async (id) =>
  deactivateAdminUser(getDb(), await requireAuth(["admin"]), id),
);
export const assignRole = command(userRoleSchema, async ({ id, role }) =>
  assignUserRole(getDb(), await requireAuth(["admin"]), id, role),
);
export const removeRole = command(userRoleSchema, async ({ id, role }) =>
  removeUserRole(getDb(), await requireAuth(["admin"]), id, role),
);
