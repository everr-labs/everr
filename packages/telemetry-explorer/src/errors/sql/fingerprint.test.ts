import { describe, expect, it } from "vitest";
import exceptionLogFilterSql from "./exception_log_filter.sql?raw";
import { ERROR_FINGERPRINT_SQL, EXCEPTION_LOG_FILTER_SQL } from "./fingerprint";
import fingerprintSql from "./fingerprint.sql?raw";

// The Rust CLI (`everr local errors`) has no server to reuse, so it groups
// Errors by `include_str!`-ing these same canonical .sql fragments. These
// assertions fail the moment fingerprint.ts drifts from them, so local grouping
// can never silently diverge from the app's. If you change the TS below, update
// the .sql file (or vice versa) so both stay identical.

// Compare token content, not layout: collapse whitespace and drop spacing
// around parens/commas (semantically irrelevant in SQL, and the .sql file and
// the TS template literal indent differently). Backslashes and regex tokens
// still have to match exactly, which is the drift we care about.
function normalize(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

describe("errors fingerprint SQL stays in sync with the CLI", () => {
  it("matches the canonical fingerprint expression", () => {
    expect(normalize(ERROR_FINGERPRINT_SQL)).toBe(normalize(fingerprintSql));
  });

  it("matches the canonical exception-log filter", () => {
    expect(normalize(EXCEPTION_LOG_FILTER_SQL)).toBe(
      normalize(exceptionLogFilterSql),
    );
  });
});
