import { z } from "zod";
export const userIdSchema = z.number().int().positive();
export const roleSchema = z.enum(["user", "mis", "approver", "admin"]);
export const adminUserListSchema = z
  .object({
    search: z.string().optional(),
    role: roleSchema.optional(),
    department_id: z.coerce.number().int().positive().optional(),
    is_active: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z
      .enum([
        "id",
        "first_name",
        "last_name",
        "username",
        "email",
        "created_at",
      ])
      .default("created_at"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();
const editable = z
  .object({
    first_name: z.string().trim().min(1).max(50),
    last_name: z.string().trim().min(1).max(50),
    username: z.string().min(3).max(50),
    email: z.email(),
    password: z.string().min(8),
    position: z.string().max(100).nullable().optional(),
    department_id: userIdSchema.nullable().optional(),
    is_active: z.boolean().optional(),
    message_notifications: z.boolean().optional(),
  })
  .strict();
export const createUserSchema = editable;
export const updateUserDataSchema = editable
  .partial()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "No fields to update",
  );
export const updateUserSchema = z
  .object({ id: userIdSchema, data: updateUserDataSchema })
  .strict();
export const userRoleSchema = z
  .object({ id: userIdSchema, role: roleSchema })
  .strict();
