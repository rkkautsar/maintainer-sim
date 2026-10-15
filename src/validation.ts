import { z } from "zod";

export const positiveId = z.number().int().positive().safe();
export const record = z.record(z.string(), z.unknown());

/** Reject invalid boundary data without putting its contents into error logs. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidData();
  return result.data;
}

export class InvalidData extends Error {
  constructor() {
    super("Invalid boundary data");
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
