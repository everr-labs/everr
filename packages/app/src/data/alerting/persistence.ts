import { AlertingError } from "./errors";

export function throwAlertingPersistenceError(
  status: number,
  code: string,
  message: string,
): never {
  throw new AlertingError(status, code, message);
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
