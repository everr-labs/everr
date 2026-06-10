import { describe, expect, it } from "vitest";
import {
  extractVariables,
  renderMessage,
  renderQuery,
  validateMessageTemplate,
  validateQueryTemplate,
  validateTopColumns,
} from "./template";

describe("extractVariables", () => {
  it("finds valid alert variables and ignores malformed ones", () => {
    expect(extractVariables(`a \${window} b \${top_route} \${1bad}`)).toEqual([
      "window",
      "top_route",
    ]);
  });
});

describe("validateQueryTemplate", () => {
  it("allows only window variables", () => {
    expect(() =>
      validateQueryTemplate(`WHERE t >= now() - INTERVAL \${window}`),
    ).not.toThrow();
    expect(() => validateQueryTemplate(`SELECT \${row_count}`)).toThrow(
      /row_count/,
    );
  });
});

describe("validateMessageTemplate", () => {
  it("allows row_count and top_<column>, rejecting other variables", () => {
    expect(() =>
      validateMessageTemplate(`\${row_count} \${top_route}`),
    ).not.toThrow();
    expect(() => validateMessageTemplate(`\${window}`)).toThrow(/window/);
    expect(() => validateMessageTemplate(`\${whatever}`)).toThrow(/whatever/);
  });
});

describe("validateTopColumns", () => {
  it("rejects top_ variables whose column is missing from the result schema", () => {
    expect(() =>
      validateTopColumns(`\${top_route}`, ["route", "n"]),
    ).not.toThrow();
    expect(() => validateTopColumns(`\${top_missing}`, ["route"])).toThrow(
      /missing/,
    );
  });
});

describe("rendering", () => {
  it("renderQuery expands window variables", () => {
    expect(renderQuery(`INTERVAL \${window}`, "5 MINUTE")).toBe(
      "INTERVAL 5 MINUTE",
    );
  });

  it("renderMessage fills row_count and top_ columns, empty string when no rows", () => {
    expect(
      renderMessage(`\${row_count} bad, top \${top_route}`, {
        rowCount: 3,
        firstRow: { route: "/api/x" },
      }),
    ).toBe("3 bad, top /api/x");
    expect(
      renderMessage(`top \${top_route}`, {
        rowCount: 0,
        firstRow: undefined,
      }),
    ).toBe("top ");
  });
});
