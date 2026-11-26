import { z } from 'zod';
export const contactIdSchema = z.number().int().positive();
export const sendMessageSchema = z.object({ receiver_id: contactIdSchema, content: z.string().trim().min(1).max(20_000), ticket_id: contactIdSchema.optional() }).strict();
export const contactSearchSchema = z.string().max(255);
