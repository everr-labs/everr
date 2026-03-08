import { describe, expect, it } from "vitest";
import { buildFilterConditions } from "./filters";

describe("buildFilterConditions", () => {
  const fromISO = "2025-01-01 00:00:00.000";
  const toISO = "2025-01-07 23:59:59.999";

  it("adds scoped leaf filter at root level", () => {
    const { scopeConditions } = buildFilterConditions(fromISO, toISO, {
      timeRange: { from: "now-7d", to: "now" },
      repo: "acme/repo",
      branch: "main",
    });

    const sql = scopeConditions.join("\n");
    expect(sql).toContain("NOT IN");
    expect(sql).toContain(
      "ResourceAttributes['vcs.repository.name'] = {repo:String}",
    );
    expect(sql).toContain(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
  });

  it("uses package parent root condition for package view", () => {
    const { conditions, aggregateByRun, scopeConditions } =
      buildFilterConditions(fromISO, toISO, {
        timeRange: { from: "now-7d", to: "now" },
        pkg: "pkg-a",
      });

    const sql = conditions.join("\n");
    expect(sql).toContain("SpanAttributes['everr.test.parent_test'] = ''");
    expect(aggregateByRun).toBe(true);
    expect(scopeConditions).toHaveLength(0);
  });

  it("uses exact path when provided and disables run aggregation", () => {
    const { conditions, aggregateByRun } = buildFilterConditions(
      fromISO,
      toISO,
      {
        timeRange: { from: "now-7d", to: "now" },
        pkg: "pkg-a",
        path: "suite/test",
      },
    );

    const sql = conditions.join("\n");
    expect(sql).toContain(
      "SpanAttributes['everr.test.name'] = {exactPath:String}",
    );
    expect(aggregateByRun).toBe(false);
  });
});
