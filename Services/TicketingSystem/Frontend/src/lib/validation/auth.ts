import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  email: z.email(),
  first_name: z.string().min(1).max(50),
  last_name: z.string().min(1).max(50),
  position: z.string().max(100).optional(),
  department_id: z.number().int().positive().optional(),
});

export const profileSchema = z.object({
  first_name: z.string().min(1).max(50).optional(),
  last_name: z.string().min(1).max(50).optional(),
  email: z.email().optional(),
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(8).optional(),
  message_notifications: z.boolean().optional(),
}).refine(value => Object.values(value).some(field => field !== undefined), 'No fields to update');
