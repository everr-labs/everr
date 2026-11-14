import { describe, expect, it } from "vite-plus/test";
import { renderMessage } from "#app/data/alerting/delivery/template.ts";
import { DEFAULT_IGNORED_ERRORS, newErrorsRuleSpec, optionsOfRule } from "./detection";

const options = { environment: "production", minOccurrences: 3, ignore: ["ETIMEDOUT"] };

describe("the issue for a new error", () => {
  const spec = newErrorsRuleSpec(options, "https://app.everr.dev");
  const row = {
    fingerprint: "5e456a8e58e011db",
    service: "search",
    exception_type: "NotFoundError",
    message: "User <n> not found",
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

  it("titles the issue with the message's template, not the raw message", () => {
    expect(renderMessage(spec.annotations.summary ?? "", { firstRow: row })).toBe(
      "NotFoundError: User <n> not found",
    );
    expect(spec.sql).toContain("errorMessageTemplate(");
    expect(spec.sql).not.toContain("exception.stacktrace");
  });

  it("opens only once the error happened often enough, and skips the listed errors", () => {
    expect(spec.condition).toEqual({ operator: "gte", threshold: 3 });
    expect(spec.sql).toContain("multiSearchAnyCaseInsensitive(");
    expect(spec.sql).toContain("['ETIMEDOUT']");
  });

  it("keeps a pattern to skip from breaking out of its string", () => {
    const sql = newErrorsRuleSpec(
      { ...options, ignore: ["it's \\ odd"] },
      "https://app.everr.dev",
    ).sql;
    expect(sql).toContain("['it\\'s \\\\ odd']");
  });

  it("reads back the options it was made with", () => {
    expect(optionsOfRule(spec)).toEqual(options);
    const { "everr.error_issues.ignore": _ignore, ...older } = spec.annotations;
    expect(optionsOfRule({ ...spec, annotations: older })?.ignore).toEqual(DEFAULT_IGNORED_ERRORS);
  });
});
