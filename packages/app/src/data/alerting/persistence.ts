import type { z } from "zod";
import { firstZodIssue } from "@/lib/zod-issue";
import { AlertingError } from "./errors";

export function throwAlertingPersistenceError(
  status: number,
  code: string,
  message: string,
): never {
  throw new AlertingError(status, code, message);
}

/**
 * Parse what a caller sent, reporting a rejection as the domain's own 422.
 *
 * A ZodError says only that a schema did not match; it does not say whose
 * fault that was. The same error comes out of reading a stored channel config,
 * so a transport that treated every ZodError as bad input would blame the
 * caller for the server's own data, and would hide a real corruption from the
 * error reporter behind a 422. Saying it here is the domain making the claim
 * it can actually make.
 */
export function parseAlertingInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throwAlertingPersistenceError(422, "validation", firstZodIssue(result.error));
}

function postgresCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") return record.code;
  return postgresCode(record.cause);
}

export async function translateAlertingConflict<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (postgresCode(cause) === "23505" || postgresCode(cause) === "23503") {
      throwAlertingPersistenceError(
        409,
        "conflict",
        "alerting resource conflicts with existing state",
      );
    }
    throw cause;
  }
}
