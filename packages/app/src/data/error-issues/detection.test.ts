import { describe, expect, it } from "vite-plus/test";
import { renderMessage } from "#app/data/alerting/delivery/template.ts";
import { newErrorsRuleSpec } from "./detection";

describe("the issue for a new error", () => {
  const spec = newErrorsRuleSpec("production", "https://app.everr.dev");
  const row = {
    fingerprint: "5e456a8e58e011db",
    service: "search",
    first_seen: "2026-11-14 13:50:00",
    occurrences: 4,
  };
  const description = renderMessage(spec.annotations.description ?? "", { firstRow: row });

  it("hands the agent a query for the error's occurrences in Everr", () => {
    expect(description).toContain("A new error in search, first seen in production");
    expect(description).toContain("https://app.everr.dev/errors/5e456a8e58e011db/modal");
    expect(description).toMatch(/```sql\n[\s\S]*= '5e456a8e58e011db'[\s\S]*\n```/);
  });

  it("tells the agent how to confirm the fix against a local collector", () => {
    expect(description).toContain("`everr local start -d`");
    expect(description).toContain("run the query above with `everr local query`");
    // Earlier reproductions stay in the local store, so the check needs a start time.
    expect(description).toContain("AND Timestamp >= '<that time>'");
  });

  it("copies no stack trace or trace id into the issue", () => {
    expect(spec.sql).not.toContain("exception.stacktrace");
    expect(spec.sql).not.toContain("TraceId");
  });
});
