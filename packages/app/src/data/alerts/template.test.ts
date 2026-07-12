import { describe, expect, it } from "vitest";
import {
  extractVariables,
  renderInstanceMessage,
  renderMessage,
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
  it("allows any query result column, and the value placeholder when a value column is set", () => {
    expect(() =>
      validateMessageRefs(`\${route} at \${value}`, ["route"], true),
    ).not.toThrow();
    // Non-label columns resolve from the event's evidence at render time.
    expect(() =>
      validateMessageRefs(`\${errors} on \${route}`, ["route", "errors"], true),
    ).not.toThrow();
    expect(() => validateMessageRefs("no refs", [], false)).not.toThrow();
  });

  it("rejects refs to columns the query does not return, listing the columns", () => {
    expect(() =>
      validateMessageRefs(`\${n}`, ["route", "errors"], false),
    ).toThrow(
      /\$\{n\} is not a column of the query result.*\(available: route, errors\)/,
    );
    expect(() => validateMessageRefs(`\${n}`, [], false)).toThrow(
      /the query returned no columns/,
    );
  });

  it("rejects the value placeholder when the rule has no value column", () => {
    expect(() => validateMessageRefs(`\${value}`, ["route"], false)).toThrow(
      /requires spec\.valueColumn/,
    );
    // A result column literally named "value" is fine: CC falls through to it
    // (via labels or evidence) when the rule has no value column.
    expect(() =>
      validateMessageRefs(`\${value}`, ["value"], false),
    ).not.toThrow();
  });
});

describe("rendering", () => {
  it("renderMessage fills columns and uses an empty string when no rows", () => {
    expect(
      renderMessage(`route \${route}`, {
        firstRow: { route: "/api/x" },
      }),
    ).toBe("route /api/x");
    expect(
      renderMessage(`route \${route}`, {
        firstRow: undefined,
      }),
    ).toBe("route ");
  });

  it("renderInstanceMessage resolves labels over evidence, then value", () => {
    expect(
      renderInstanceMessage(`\${host} returned \${status} x\${value}`, {
        // "host" exists in both: the instance label wins, as in the engine.
        labels: { host: "web-1" },
        value: 42,
        evidence: { host: "stale", status: 500 },
      }),
    ).toBe("web-1 returned 500 x42");
  });

  it("renderInstanceMessage leaves unresolvable refs empty", () => {
    expect(
      renderInstanceMessage(`\${host} \${value}`, {
        labels: {},
        value: null,
        evidence: null,
      }),
    ).toBe(" ");
  });
});
