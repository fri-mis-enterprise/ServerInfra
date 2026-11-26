import { query } from '$app/server';
import { requireAuth } from './server/auth';
import { getDb } from './server/db';
import { readActiveUsers, readApprovers, readAssignees, readUserDirectory } from './server/user-reads';
import { assigneeFilterSchema } from './validation/users';

export const getUserDirectory = query(async () => {
  await requireAuth();
  return readUserDirectory(getDb());
});
export const getActiveUsers = query(async () => readActiveUsers(getDb(), await requireAuth()));
export const getApprovers = query(async () => {
  await requireAuth();
  return readApprovers(getDb());
});
export const getAssignees = query(assigneeFilterSchema, async input => {
  await requireAuth();
  return readAssignees(getDb(), input);
});
