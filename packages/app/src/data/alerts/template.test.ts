import { describe, expect, it } from "vitest";
import {
  extractVariables,
  renderMessage,
  validateMessageColumns,
  validateMessageTemplate,
  validateQueryTemplate,
} from "./template";

describe("extractVariables", () => {
  it("finds valid alert variables and ignores malformed ones", () => {
    expect(extractVariables(`a \${window} b \${route} \${1bad}`)).toEqual([
      "window",
      "route",
    ]);
  });
});

describe("validateQueryTemplate", () => {
  it("rejects query variables", () => {
    expect(() => validateQueryTemplate("SELECT 1")).not.toThrow();
    expect(() =>
      validateQueryTemplate(`WHERE t >= now() - INTERVAL \${window}`),
    ).toThrow(/window/);
    expect(() => validateQueryTemplate(`SELECT \${row_count}`)).toThrow(
      /row_count/,
    );
  });
});

describe("validateMessageTemplate", () => {
  it("allows row_count and column variables", () => {
    expect(() =>
      validateMessageTemplate(`\${row_count} \${route}`),
    ).not.toThrow();
    expect(() => validateMessageTemplate(`\${window}`)).not.toThrow();
    expect(() => validateMessageTemplate(`\${whatever}`)).not.toThrow();
  });
});

describe("validateMessageColumns", () => {
  it("rejects column variables missing from the result schema", () => {
    expect(() =>
      validateMessageColumns(`\${route}`, ["route", "n"]),
    ).not.toThrow();
    expect(() => validateMessageColumns(`\${missing}`, ["route"])).toThrow(
      /missing/,
    );
  });
});

describe("rendering", () => {
  it("renderMessage fills row_count and columns, empty string when no rows", () => {
    expect(
      renderMessage(`\${row_count} bad, route \${route}`, {
        rowCount: 3,
        firstRow: { route: "/api/x" },
      }),
    ).toBe("3 bad, route /api/x");
    expect(
      renderMessage(`route \${route}`, {
        rowCount: 0,
        firstRow: undefined,
      }),
    ).toBe("route ");
  });
});
