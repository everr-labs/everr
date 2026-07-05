const EXPECTED_SERVER_FUNCTION_MESSAGES = new Set([
  "Alert not found",
  "No active organization",
  "Unauthenticated",
]);

const EXPECTED_SQL_API_ERROR_TYPES = new Set([
  "ACCESS_DENIED",
  "BAD_ARGUMENTS",
  "ILLEGAL_TYPE_OF_ARGUMENT",
  "QUERY_IS_TOO_LARGE",
  "QUERY_WAS_CANCELLED",
  "SYNTAX_ERROR",
  "TIMEOUT_EXCEEDED",
  "TOO_MANY_ROWS_OR_BYTES",
  "UNKNOWN_DATABASE",
  "UNKNOWN_IDENTIFIER",
  "UNKNOWN_TABLE",
]);

const EXPECTED_SQL_API_ERROR_CODES = new Set([
  "47", // UNKNOWN_IDENTIFIER
  "60", // UNKNOWN_TABLE
  "62", // SYNTAX_ERROR
  "81", // UNKNOWN_DATABASE
  "159", // TIMEOUT_EXCEEDED
  "241", // MEMORY_LIMIT_EXCEEDED
  "396", // TOO_MANY_ROWS_OR_BYTES
  "497", // ACCESS_DENIED
]);

const EXPECTED_SQL_API_MESSAGES = [
  /column .* is not under aggregate function/i,
  /limit for result exceeded/i,
  /not enough privileges/i,
  /query is too large/i,
  /quota/i,
  /read[- ]only/i,
  /syntax error/i,
  /unknown (?:column|database|expression|identifier|table)/i,
];

type ClickhouseTelemetryAttributes = {
  client: string;
};

export function isExpectedServerFunctionError(error: unknown): boolean {
  return error instanceof Error && EXPECTED_SERVER_FUNCTION_MESSAGES.has(error.message);
}

export function isExpectedSqlApiQueryError(
  attributes: ClickhouseTelemetryAttributes,
  error: unknown,
): boolean {
  if (attributes.client !== "sql_api") return false;

  const errorType = readErrorField(error, "type");
  if (errorType && EXPECTED_SQL_API_ERROR_TYPES.has(errorType)) return true;

  const errorCode = readErrorField(error, "code");
  if (errorCode && EXPECTED_SQL_API_ERROR_CODES.has(errorCode)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return EXPECTED_SQL_API_MESSAGES.some((pattern) => pattern.test(message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorField(error: unknown, field: "code" | "type") {
  if (!isRecord(error)) return "";

  const value = error[field];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
