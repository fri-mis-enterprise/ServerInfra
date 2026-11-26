import { z } from "zod";
const id = z.number().int().positive();
const rating = z.number().int().min(1).max(5);
const date = z
  .string()
  .refine(
    (value) => value.trim().length > 0 && Number.isFinite(Date.parse(value)),
    "Invalid date",
  );
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
export const submitCsatSchema = z
  .object({
    ticket_id: id,
    rating_speed: rating,
    rating_attitude: rating,
    rating_impact: rating,
    comment: z.string().max(10000).optional(),
  })
  .strict();
export const csatStatsSchema = z
  .object({
    agent_id: id.optional(),
    start_date: date.optional(),
    end_date: date.optional(),
    month: month.optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.start_date ||
      !input.end_date ||
      Date.parse(input.start_date) <= Date.parse(input.end_date),
    "Start date must not follow end date",
  );
export const agentReportSchema = z
  .object({ agent_id: id, month: month.optional() })
  .strict();
export const csatPageSchema = z
  .object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const csatTicketSchema = id;
