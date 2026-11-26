import { z } from 'zod';

export const assigneeFilterSchema = z.object({ department_id: z.number().int().positive().optional() }).strict();
