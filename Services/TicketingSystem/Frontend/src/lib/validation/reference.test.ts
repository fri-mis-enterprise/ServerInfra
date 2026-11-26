import { expect, test } from 'bun:test';
import { createDepartmentSchema, createRequestTypeSchema, updateAffectedSystemSchema } from './reference';
import { profileSchema } from './auth';

test('reference schemas allow only the editable fields for each kind', () => {
  const base = { name: ' MIS ', description: '', is_active: true };
  expect(createDepartmentSchema.parse(base)).toEqual({ name: 'MIS', description: null, is_active: true });
  expect(createDepartmentSchema.safeParse({ ...base, id: 99 }).success).toBe(false);
  expect(createDepartmentSchema.safeParse({ ...base, requires_approval_by_default: true }).success).toBe(false);
  expect(createRequestTypeSchema.safeParse({ ...base, requires_approval_by_default: true }).success).toBe(true);
  expect(updateAffectedSystemSchema.safeParse({ ...base, department_id: -1 }).success).toBe(false);
  expect(updateAffectedSystemSchema.parse({ ...base, department_id: null }).department_id).toBeNull();
});

test('profile changes cannot add roles and require an editable field', () => {
  expect(profileSchema.safeParse({ roles: ['admin'] }).success).toBe(false);
  expect(profileSchema.safeParse({}).success).toBe(false);
  expect(profileSchema.parse({ message_notifications: false, is_active: true })).toEqual({ message_notifications: false });
  expect(profileSchema.safeParse({ password: 'short' }).success).toBe(false);
});
