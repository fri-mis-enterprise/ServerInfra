import { z } from 'zod';

export const nameSchema = z.string().trim().min(1, 'Name is required.').max(255);
export const descriptionSchema = z.string().trim().nullable().optional().transform((v) => (v === '' ? null : v ?? null));
export const departmentIdSchema = z.number().int().positive();

const baseFields = {
  name: nameSchema,
  description: descriptionSchema,
  is_active: z.boolean(),
};

export const createDepartmentSchema = z.object({ ...baseFields }).strict();
export const updateDepartmentSchema = z.object({ ...baseFields }).strict();

export const createAffectedSystemSchema = z.object({
  ...baseFields,
  department_id: departmentIdSchema.nullable().optional(),
}).strict();
export const updateAffectedSystemSchema = z.object({
  ...baseFields,
  department_id: departmentIdSchema.nullable().optional(),
}).strict();

export const createRequestTypeSchema = z.object({
  ...baseFields,
  requires_approval_by_default: z.boolean(),
  department_id: departmentIdSchema.nullable().optional(),
}).strict();
export const updateRequestTypeSchema = z.object({
  ...baseFields,
  requires_approval_by_default: z.boolean(),
  department_id: departmentIdSchema.nullable().optional(),
}).strict();

export const createHardwareItemSchema = z.object({ ...baseFields }).strict();
export const updateHardwareItemSchema = z.object({ ...baseFields }).strict();

export const idSchema = z.number().int().positive();
