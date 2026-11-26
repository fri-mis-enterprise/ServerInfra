import { command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from './server/db/index';
import { requireAuth } from './server/auth';
import { affectedSystems, departments, hardwareItems, requestTypes } from './server/db/schema';
import {
  createAffectedSystemSchema,
  createDepartmentSchema,
  createHardwareItemSchema,
  createRequestTypeSchema,
  idSchema,
  updateAffectedSystemSchema,
  updateDepartmentSchema,
  updateHardwareItemSchema,
  updateRequestTypeSchema,
} from './validation/reference';
import { asc, eq } from 'drizzle-orm';

const kindSchema = z.enum(['departments', 'affected-systems', 'request-types', 'hardware-items']);

const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('departments'), data: createDepartmentSchema }).strict(),
  z.object({ kind: z.literal('affected-systems'), data: createAffectedSystemSchema }).strict(),
  z.object({ kind: z.literal('request-types'), data: createRequestTypeSchema }).strict(),
  z.object({ kind: z.literal('hardware-items'), data: createHardwareItemSchema }).strict(),
]);

const updateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('departments'), id: idSchema, data: updateDepartmentSchema }).strict(),
  z.object({ kind: z.literal('affected-systems'), id: idSchema, data: updateAffectedSystemSchema }).strict(),
  z.object({ kind: z.literal('request-types'), id: idSchema, data: updateRequestTypeSchema }).strict(),
  z.object({ kind: z.literal('hardware-items'), id: idSchema, data: updateHardwareItemSchema }).strict(),
]);

const deleteSchema = z.object({ kind: kindSchema, id: idSchema }).strict();

function isUniqueError(e: unknown): boolean {
  while (e instanceof Error) {
    if (e.message.includes('UNIQUE constraint failed')) return true;
    e = e.cause;
  }
  return false;
}

function assertDepartmentExists(db: ReturnType<typeof getDb>, departmentId: number | null | undefined) {
  if (departmentId == null) return;
  const [dept] = db.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).all();
  if (!dept) error(400, 'Department not found');
}

const tables = {
  departments: { table: departments, label: 'Department' },
  'affected-systems': { table: affectedSystems, label: 'Affected system' },
  'request-types': { table: requestTypes, label: 'Request type' },
  'hardware-items': { table: hardwareItems, label: 'Hardware item' },
} as const;

export const getReferenceData = query(async () => {
  const db = getDb();
  return {
    departments: db.select().from(departments).where(eq(departments.is_active, true)).orderBy(asc(departments.name)).all(),
    affectedSystems: db.select().from(affectedSystems).where(eq(affectedSystems.is_active, true)).orderBy(asc(affectedSystems.name)).all(),
    requestTypes: db.select().from(requestTypes).where(eq(requestTypes.is_active, true)).orderBy(asc(requestTypes.name)).all(),
    hardwareItems: db.select().from(hardwareItems).where(eq(hardwareItems.is_active, true)).orderBy(asc(hardwareItems.name)).all(),
  };
});

export const createReferenceItem = command(createSchema, async (input) => {
  await requireAuth(['admin']);
  const db = getDb();
  const config = tables[input.kind];
  const data = input.data;
  if (input.kind === 'affected-systems' || input.kind === 'request-types') assertDepartmentExists(db, input.data.department_id);
  try {
    return db.insert(config.table).values(data).returning().get();
  } catch (e) {
    if (isUniqueError(e)) error(409, 'Name already exists');
    throw e;
  }
});

export const updateReferenceItem = command(updateSchema, async (input) => {
  await requireAuth(['admin']);
  const db = getDb();
  const config = tables[input.kind];
  const existing = db.select({ id: config.table.id }).from(config.table).where(eq(config.table.id, input.id)).get();
  if (!existing) error(404, `${config.label} not found`);
  const data = input.data;
  if (input.kind === 'affected-systems' || input.kind === 'request-types') assertDepartmentExists(db, input.data.department_id);
  try {
    return db.update(config.table).set(data).where(eq(config.table.id, input.id)).returning().get();
  } catch (e) {
    if (isUniqueError(e)) error(409, 'Name already exists');
    throw e;
  }
});

export const deleteReferenceItem = command(deleteSchema, async (input) => {
  await requireAuth(['admin']);
  const db = getDb();
  const config = tables[input.kind];
  const existing = db.select({ id: config.table.id }).from(config.table).where(eq(config.table.id, input.id)).get();
  if (!existing) error(404, `${config.label} not found`);
  db.update(config.table).set({ is_active: false }).where(eq(config.table.id, input.id)).run();
  return undefined;
});
