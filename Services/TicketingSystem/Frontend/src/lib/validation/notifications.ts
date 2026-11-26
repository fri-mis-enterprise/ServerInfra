import { z } from 'zod';
export const notificationIdSchema = z.number().int().positive();
export const notificationListSchema = z.object({ page: z.number().int().positive().default(1), limit: z.number().int().min(1).max(100).default(50), unread_only: z.enum(['true', 'false']).optional() }).strict();
export const pushSubscriptionSchema = z.object({ endpoint: z.url().max(4096).refine(value => new URL(value).protocol === 'https:', 'Push endpoints must use HTTPS'), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(40).max(256), auth: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(16).max(256) }).strict() }).strict();
