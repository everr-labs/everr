import { ClickHouseError } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import {
  classifyCloudQueryError,
  extractQueryShape,
} from "@/lib/sql-api-observability";

// The guard (when present) throws an Error named "SqlApiGuardError"; the
// classifier matches on the name, so the test reproduces that shape directly.
function guardError(): Error {
  const error = new Error("blocked");
  error.name = "SqlApiGuardError";
  return error;
}

// ClickHouseError's constructor is internal; build one with the fields the
// classifier reads (code, type) via the prototype so `instanceof` holds.
function clickhouseError(code: string, type?: string): ClickHouseError {
  const error = Object.create(ClickHouseError.prototype) as ClickHouseError & {
    code: string;
    type?: string;
    message: string;
  };
  error.code = code;
  error.type = type;
  error.message = `ClickHouse error ${code}`;
  return error;
}

describe("classifyCloudQueryError", () => {
  it("classifies a guard rejection as a blocked user error", () => {
    expect(classifyCloudQueryError(guardError())).toEqual({
      outcome: "user_error",
      kind: "guard_blocked",
    });
  });

  it("classifies schema-probe codes as a user error", () => {
    for (const code of ["497", "60", "81"]) {
      expect(classifyCloudQueryError(clickhouseError(code))).toEqual({
        outcome: "user_error",
        kind: "schema_probe",
      });
    }
  });

  it("classifies schema-probe by error type too", () => {
    expect(
      classifyCloudQueryError(clickhouseError("999", "UNKNOWN_TABLE")),
    ).toEqual({ outcome: "user_error", kind: "schema_probe" });
  });

  it("classifies known infrastructure codes as system errors", () => {
    expect(classifyCloudQueryError(clickhouseError("159"))).toEqual({
      outcome: "system_error",
      kind: "timeout",
    });
    expect(classifyCloudQueryError(clickhouseError("241"))).toEqual({
      outcome: "system_error",
      kind: "resource",
    });
    expect(classifyCloudQueryError(clickhouseError("201"))).toEqual({
      outcome: "system_error",
      kind: "quota",
    });
    expect(classifyCloudQueryError(clickhouseError("210"))).toEqual({
      outcome: "system_error",
      kind: "network",
    });
  });

  it("treats any other ClickHouse error as a malformed query (fails safe, no page)", () => {
    // 47 = UNKNOWN_IDENTIFIER, a typo — must not page.
    expect(classifyCloudQueryError(clickhouseError("47"))).toEqual({
      outcome: "user_error",
      kind: "sql_invalid",
    });
  });

  it("treats a non-ClickHouse, non-guard throw as an internal system error", () => {
    expect(classifyCloudQueryError(new Error("boom"))).toEqual({
      outcome: "system_error",
      kind: "internal",
    });
  });
});

describe("extractQueryShape", () => {
  it("extracts table names after FROM and JOIN", () => {
    const { tables } = extractQueryShape(
      "SELECT * FROM traces t JOIN logs l ON t.TraceId = l.TraceId",
    );
    expect(tables).toEqual(["traces", "logs"]);
  });

  it("extracts map-subscript keys but never array-literal values", () => {
    const { attrKeys } = extractQueryShape(
      "SELECT * FROM logs WHERE LogAttributes['user.email'] = 'alice@corp.com' " +
        "AND ServiceName IN ['secret-service']",
    );
    expect(attrKeys).toEqual(["user.email"]);
    // The literal value and the array-literal element must not appear anywhere.
    expect(attrKeys).not.toContain("alice@corp.com");
    expect(attrKeys).not.toContain("secret-service");
  });

  it("dedupes repeated tables and keys", () => {
    const { tables, attrKeys } = extractQueryShape(
      "SELECT SpanAttributes['k'], SpanAttributes['k'] FROM traces UNION ALL " +
        "SELECT SpanAttributes['k'], SpanAttributes['k'] FROM traces",
    );
    expect(tables).toEqual(["traces"]);
    expect(attrKeys).toEqual(["k"]);
  });
});
