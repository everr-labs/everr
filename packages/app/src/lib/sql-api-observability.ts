import { ClickHouseError } from "@clickhouse/client";

// How a cloud-query request ended, from the alerting point of view:
//   - user_error   the caller's SQL is at fault (typo, blocked function, probing
//                  a table they can't read). Expected; never pages.
//   - system_error our infrastructure is at fault (ClickHouse timed out, ran out
//                  of memory/quota, was unreachable, or an unexpected exception).
//                  Marks the span as an error and drives the pager.
export type CloudQueryOutcome = "ok" | "user_error" | "system_error";

export type CloudQueryErrorKind =
  | "empty"
  | "guard_blocked"
  | "schema_probe"
  | "sql_invalid"
  | "timeout"
  | "quota"
  | "resource"
  | "network"
  | "internal";

export type CloudQueryClassification = {
  outcome: Exclude<CloudQueryOutcome, "ok">;
  kind: CloudQueryErrorKind;
};

// ClickHouse spells out table/column names in these; sanitizeSqlApiError already
// collapses them into one uniform message. For telemetry they are a user error
// (querying something they can't read), not an outage.
const SCHEMA_PROBE_CODES = new Set(["497", "60", "81"]);
const SCHEMA_PROBE_TYPES = new Set([
  "ACCESS_DENIED",
  "UNKNOWN_TABLE",
  "UNKNOWN_DATABASE",
]);

// ClickHouse error codes that mean our infrastructure failed, not the user's
// SQL. Everything else from ClickHouse is treated as a malformed query
// (user_error) — the common case for a read-only SQL surface. Keeping the
// system set explicit means a new, unclassified code fails safe as a user error
// (no false page) rather than a system error (false page).
const SYSTEM_ERROR_CODES: Record<string, CloudQueryErrorKind> = {
  "159": "timeout", // TIMEOUT_EXCEEDED
  "160": "timeout", // TOO_SLOW
  "201": "quota", // QUOTA_EXCEEDED
  "241": "resource", // MEMORY_LIMIT_EXCEEDED
  "202": "resource", // TOO_MANY_SIMULTANEOUS_QUERIES
  "203": "resource", // NO_FREE_CONNECTION
  "209": "network", // SOCKET_TIMEOUT
  "210": "network", // NETWORK_ERROR
  "279": "network", // ALL_CONNECTION_TRIES_FAILED
};

// Classify a thrown cloud-query error into an alertable outcome + a finer kind.
// The order matters: the guard runs before ClickHouse, schema probes are a
// specific ClickHouse sub-case, then known system codes, then everything else
// from ClickHouse is a bad query. A non-ClickHouse, non-guard throw is an
// unexpected bug in our code path — a system error.
export function classifyCloudQueryError(
  error: unknown,
): CloudQueryClassification {
  // The SQL-API introspection guard rejects a blocked query with an Error named
  // "SqlApiGuardError". Match on the name so this carries no compile dependency
  // on the guard module (which some builds don't have); when the guard is
  // absent, no such error is thrown and this branch simply never fires.
  if (error instanceof Error && error.name === "SqlApiGuardError") {
    return { outcome: "user_error", kind: "guard_blocked" };
  }

  if (error instanceof ClickHouseError) {
    if (
      SCHEMA_PROBE_CODES.has(error.code) ||
      SCHEMA_PROBE_TYPES.has(error.type ?? "")
    ) {
      return { outcome: "user_error", kind: "schema_probe" };
    }
    const systemKind = SYSTEM_ERROR_CODES[error.code];
    if (systemKind) {
      return { outcome: "system_error", kind: systemKind };
    }
    return { outcome: "user_error", kind: "sql_invalid" };
  }

  return { outcome: "system_error", kind: "internal" };
}

export type CloudQueryShape = {
  tables: string[];
  attrKeys: string[];
};

// Safe, structured facts about a query — never the query text or any literal
// value. Both patterns match only schema-identifier positions:
//   - tables:   the identifier after FROM/JOIN.
//   - attrKeys: the string inside a map subscript `Ident['key']`. ClickHouse
//     grammar guarantees a string in subscript position (identifier immediately
//     followed by `['...']`) is a map key, never an array-literal value — so
//     `IN ['secret@example.com']` (no identifier before `[`) does NOT match and
//     no user value leaks.
export function extractQueryShape(sql: string): CloudQueryShape {
  const tables = new Set<string>();
  for (const match of sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_]\w*)/gi)) {
    tables.add(match[1]);
  }

  const attrKeys = new Set<string>();
  for (const match of sql.matchAll(/\w+\['([^']+)'\]/g)) {
    attrKeys.add(match[1]);
  }

  return { tables: [...tables], attrKeys: [...attrKeys] };
}
