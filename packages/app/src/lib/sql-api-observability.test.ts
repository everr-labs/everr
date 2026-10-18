import { ClickHouseError } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { StorageNotReadyError } from "#app/common/storage-readiness.ts";
import { classifySqlQueryError } from "#app/lib/sql-api-observability.ts";

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

describe("classifySqlQueryError", () => {
  it("classifies pending storage setup as an expected account setup outcome", () => {
    expect(classifySqlQueryError(new StorageNotReadyError())).toEqual({
      outcome: "user_error",
      kind: "account_setup",
    });
  });
  it("classifies a guard rejection as a blocked user error", () => {
    expect(classifySqlQueryError(guardError())).toEqual({
      outcome: "user_error",
      kind: "guard_blocked",
    });
  });

  it("classifies schema-probe codes as a user error", () => {
    for (const code of ["497", "60", "81"]) {
      expect(classifySqlQueryError(clickhouseError(code))).toEqual({
        outcome: "user_error",
        kind: "schema_probe",
      });
    }
  });

  it("classifies schema-probe by error type too", () => {
    expect(
      classifySqlQueryError(clickhouseError("999", "UNKNOWN_TABLE")),
    ).toEqual({ outcome: "user_error", kind: "schema_probe" });
  });

  it("classifies known infrastructure codes as system errors", () => {
    expect(classifySqlQueryError(clickhouseError("159"))).toEqual({
      outcome: "system_error",
      kind: "timeout",
    });
    expect(classifySqlQueryError(clickhouseError("241"))).toEqual({
      outcome: "system_error",
      kind: "resource",
    });
    expect(classifySqlQueryError(clickhouseError("201"))).toEqual({
      outcome: "system_error",
      kind: "quota",
    });
    expect(classifySqlQueryError(clickhouseError("210"))).toEqual({
      outcome: "system_error",
      kind: "network",
    });
  });

  it("treats any other ClickHouse error as a malformed query (fails safe, no page)", () => {
    // 47 = UNKNOWN_IDENTIFIER, a typo — must not page.
    expect(classifySqlQueryError(clickhouseError("47"))).toEqual({
      outcome: "user_error",
      kind: "sql_invalid",
    });
  });

  it("treats a non-ClickHouse, non-guard throw as an internal system error", () => {
    expect(classifySqlQueryError(new Error("boom"))).toEqual({
      outcome: "system_error",
      kind: "internal",
    });
  });
});
