import { ClickHouseError } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { SCHEMA_PROBE_MESSAGE, sanitizeSqlApiError } from "./sql-api-error";

describe("sanitizeSqlApiError", () => {
  it("collapses ACCESS_DENIED into the uniform message", () => {
    const e = new ClickHouseError({
      message: "necessary to have the grant SELECT(secret) ON app.x",
      code: "497",
      type: "ACCESS_DENIED",
    });
    expect(sanitizeSqlApiError(e)).toBe(SCHEMA_PROBE_MESSAGE);
  });

  it("collapses UNKNOWN_TABLE into the uniform message", () => {
    const e = new ClickHouseError({
      message: "Table app.x doesn't exist",
      code: "60",
      type: "UNKNOWN_TABLE",
    });
    expect(sanitizeSqlApiError(e)).toBe(SCHEMA_PROBE_MESSAGE);
  });

  it("passes through a normal error message", () => {
    expect(sanitizeSqlApiError(new Error("Syntax error near FROM"))).toBe(
      "Syntax error near FROM",
    );
  });

  it("falls back for non-Error values", () => {
    expect(sanitizeSqlApiError("boom")).toBe("Failed to execute SQL query.");
  });
});
