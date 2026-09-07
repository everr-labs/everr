import { describe, expect, it } from "vitest";
import {
  extractVariables,
  validateMessageRefs,
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

describe("validateMessageRefs", () => {
  it("allows any query result column, including the conventional value column", () => {
    expect(() =>
      validateMessageRefs(`\${route} at \${value}`, ["route", "value"]),
    ).not.toThrow();
    // Non-label columns resolve from the event's evidence at render time.
    expect(() =>
      validateMessageRefs(`\${errors} on \${route}`, ["route", "errors"]),
    ).not.toThrow();
    expect(() => validateMessageRefs("no refs", [])).not.toThrow();
    expect(() => validateMessageRefs(`\${value}`, ["value"])).not.toThrow();
  });

  it("rejects refs to columns the query does not return", () => {
    expect(() => validateMessageRefs(`\${n}`, ["route", "errors"])).toThrow(
      /\$\{n\} is not a column of the query result.*\(available: route, errors\)/,
    );
    expect(() => validateMessageRefs(`\${n}`, [])).toThrow(
      /the query returned no columns/,
    );
    expect(() => validateMessageRefs(`\${value}`, ["route"])).toThrow(
      /\$\{value\} is not a column of the query result/,
    );
  });
});
