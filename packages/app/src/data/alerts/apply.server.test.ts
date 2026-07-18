import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
}));

vi.mock("@/lib/clickhouse", () => ({ querySqlApiWithMeta: vi.fn() }));

// The reconciler builds absolute notification links from the app origin; tests
// must not depend on real (validated) server env.
vi.mock("@/env/auth", () => ({
  authEnv: { BETTER_AUTH_URL: "https://app.example.com" },
}));

import { ApplyValidationError } from "@/data/as-code/errors";
import * as cc from "@/data/cc/client";
import { CcApiError } from "@/data/cc/errors";
import type { DbExecutor } from "@/db/client";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import { applyAlertSpecs } from "./apply.server";
import { isOwnedRule, OWN_NAME, OWN_PREVIEW, OWN_REPO } from "./mapping";

// The simple-alert reconciler talks to CC over HTTP and never touches Postgres,
// so the Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

const ch = vi.mocked(querySqlApiWithMeta);
const mockedListRules = cc.listRules as ReturnType<typeof vi.fn>;
const mockedCreateRule = cc.createRule as ReturnType<typeof vi.fn>;
const mockedUpdateRule = cc.updateRule as ReturnType<typeof vi.fn>;
const mockedDeleteRule = cc.deleteRule as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  ch.mockResolvedValue({
    rows: [{ service: "api", count: 1 }],
    columns: ["service", "count"],
  });
  mockedListRules.mockResolvedValue([]);
  // A live create is followed by a PUT stamping link.alert, which needs the
  // freshly minted id + version.
  mockedCreateRule.mockResolvedValue({ id: "new-rule", version: 1 });
  mockedUpdateRule.mockResolvedValue({ id: "new-rule", version: 2 });
});

function alert(name = "high-errors", overrides = {}) {
  return {
    kind: "AlertRule",
    metadata: { name },
    spec: {
      evaluationInterval: "5m",
      // CC substitutes labels, ${value}, and evidence columns in notifications.
      notificationMessage: { title: `\${value} errors in \${service}` },
      query: "SELECT service, count() AS count FROM logs GROUP BY service",
      instanceLabels: ["service"],
      valueColumn: "count",
      ...overrides,
    },
  };
}

// A CC rule view shape as returned by listRules, matching what applying the
// default alert() fixture stores (so the fingerprints are equal).
function managedRule(name: string, over: Record<string, unknown> = {}) {
  return {
    id: `rule-${name}`,
    version: 3,
    spec: {
      sql: "SELECT service, count() AS count FROM logs GROUP BY service",
      interval_secs: 300,
      for_secs: 0,
      label_columns: ["service"],
      value_column: "count",
      severity: "info",
      annotations: {
        [OWN_NAME]: name,
        [OWN_REPO]: "repo-1",
        "everr.notification.title": `\${value} errors in \${service}`,
        summary: `\${value} errors in \${service}`,
        "link.alert": `https://app.example.com/alerts/rules/rule-${name}`,
      },
      resolve_after: 1,
      suppressed: false,
      ...over,
    },
  };
}

// A stored PREVIEW copy of the alert() fixture: suppressed and tagged with its
// owning preview registry id, link.alert pointing at its own rule id.
function previewRule(
  name: string,
  previewId: string,
  over: Record<string, unknown> = {},
) {
  const base = managedRule(name);
  return {
    ...base,
    id: `prev-rule-${name}`,
    spec: {
      ...base.spec,
      annotations: {
        ...base.spec.annotations,
        [OWN_PREVIEW]: previewId,
        "link.alert": `https://app.example.com/alerts/rules/prev-rule-${name}`,
      },
      suppressed: true,
      ...over,
    },
  };
}

describe("applyAlertSpecs", () => {
  it("creates a managed CC rule, then stamps link.alert with the new id", async () => {
    await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    const [org, spec] = mockedCreateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(spec.annotations[OWN_NAME]).toBe("high-errors");
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
    expect(isOwnedRule(spec, "repo-1")).toBe(true);
    expect(spec.annotations.summary).toBe(`\${value} errors in \${service}`);
    expect(spec.interval_secs).toBe(300);
    expect(spec.value_column).toBe("count");

    // The alert-detail URL requires the CC rule id, which exists only after
    // create: an immediate follow-up PUT (guarded by the fresh version) sets it.
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1);
    const [uOrg, uId, uSpec, uVersion] = mockedUpdateRule.mock.calls[0];
    expect(uOrg).toBe("o");
    expect(uId).toBe("new-rule");
    expect(uVersion).toBe(1);
    expect(uSpec.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/new-rule",
    );
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("dry-run plans without mutating", async () => {
    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res).toEqual({
      created: ["high-errors"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("preview apply creates a suppressed rule tagged with the preview id", async () => {
    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    // Full validation ran (the query was checked against ClickHouse)...
    expect(ch).toHaveBeenCalledTimes(1);
    // ...and the rule was REALLY registered, exactly like a live create but
    // suppressed (evaluated, never notifying) and preview-tagged.
    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    const [org, spec] = mockedCreateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations[OWN_PREVIEW]).toBe("p1");
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
    expect(isOwnedRule(spec, "repo-1")).toBe(true);

    // The link.alert stamp works exactly like the live path: a follow-up PUT
    // with the freshly minted id, still suppressed.
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1);
    const [, uId, uSpec, uVersion] = mockedUpdateRule.mock.calls[0];
    expect(uId).toBe("new-rule");
    expect(uVersion).toBe(1);
    expect(uSpec.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/new-rule",
    );
    expect(uSpec.suppressed).toBe(true);

    expect(res.created).toEqual(["high-errors"]);
    expect(res.deleted).toEqual([]);
    expect(res.note).toMatch(/suppressed/);
  });

  it("scopes a preview reconcile to rules tagged with ITS preview id", async () => {
    mockedListRules.mockResolvedValue([
      // Live rule in the same repo: invisible to the preview reconcile.
      managedRule("high-errors"),
      // This preview's rule, absent from config: pruned.
      previewRule("stale", "p1"),
      // Another preview's rule: never touched.
      previewRule("other", "p2"),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
      db,
      resources: [],
    });

    expect(res.deleted).toEqual(["stale"]);
    expect(mockedDeleteRule).toHaveBeenCalledTimes(1);
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "prev-rule-stale");
  });

  it("leaves an unchanged preview rule alone and updates a changed one in place", async () => {
    mockedListRules.mockResolvedValue([previewRule("high-errors", "p1")]);
    const unchanged = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });
    expect(unchanged.created).toEqual([]);
    expect(unchanged.updated).toEqual([]);
    expect(unchanged.deleted).toEqual([]);
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();

    mockedListRules.mockResolvedValue([
      previewRule("high-errors", "p1", {
        sql: "SELECT service, count() AS count FROM old_logs GROUP BY service",
      }),
    ]);
    const changed = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });
    expect(changed.updated).toEqual(["high-errors"]);
    const [, id, spec, version] = mockedUpdateRule.mock.calls[0];
    expect(id).toBe("prev-rule-high-errors");
    expect(version).toBe(3);
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations[OWN_PREVIEW]).toBe("p1");
  });

  it("live apply never adopts or deletes preview rules (and vice versa creates fresh)", async () => {
    // Only a preview copy of "high-errors" exists: a live apply must not adopt
    // it — it creates its own live rule — and an empty live apply must not
    // prune it.
    mockedListRules.mockResolvedValue([previewRule("high-errors", "p1")]);

    const empty = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [],
    });
    expect(empty.deleted).toEqual([]);
    expect(mockedDeleteRule).not.toHaveBeenCalled();

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });
    expect(res.created).toEqual(["high-errors"]);
    const [, spec] = mockedCreateRule.mock.calls[0];
    expect(spec.suppressed).toBe(false);
    expect(spec.annotations[OWN_PREVIEW]).toBeUndefined();
  });

  it("dry-run of a first preview apply (no registry row) plans creates without listing CC", async () => {
    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: null },
      db,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.created).toEqual(["high-errors"]);
    expect(res.deleted).toEqual([]);
    // A null preview id would alias the live scope; the reconciler must not
    // even list CC (nothing can be tagged with a not-yet-minted id).
    expect(mockedListRules).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("fails a preview apply whose query is broken (validation still runs)", async () => {
    ch.mockRejectedValueOnce(new Error("syntax error"));

    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
        db,
        resources: [{ path: "broken.yaml", resource: alert() }],
      });
      expect.fail("expected preview validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /broken\.yaml: query failed: syntax error/,
        ),
      });
    }

    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("fails a preview apply whose template references a column the query does not return", async () => {
    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
        db,
        resources: [
          {
            path: "labels.yaml",
            resource: alert("bad-ref", {
              notificationMessage: { title: `\${nope} errors` },
            }),
          },
        ],
      });
      expect.fail("expected preview validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /labels\.yaml: \$\{nope\} is not a column of the query result.*\(available: service, count\)/,
        ),
      });
    }

    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("accepts a rule with no instanceLabels whose template references result columns", async () => {
    ch.mockResolvedValue({
      rows: [{ failed_replays: 3, last_error: "boom" }],
      columns: ["failed_replays", "last_error"],
    });

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [
        {
          path: "replays.yaml",
          resource: alert("replays", {
            instanceLabels: undefined,
            valueColumn: undefined,
            notificationMessage: {
              title: `\${failed_replays} replays failed`,
              description: `last error: \${last_error}`,
            },
            query: "SELECT count() AS failed_replays, any(e) AS last_error",
          }),
        },
      ],
    });

    // Non-label columns resolve from CC's event evidence at render time; the
    // rule maps to empty label_columns (all rows collapse into one instance).
    expect(res.created).toEqual(["replays"]);
    expect(res.note).toBeUndefined();
    const [, spec] = mockedCreateRule.mock.calls[0];
    expect(spec.label_columns).toEqual([]);
  });

  it("warns (without failing) when evidence refs exceed CC's 16-column evidence cap", async () => {
    const columns = Array.from({ length: 17 }, (_, i) => `c${i}`);
    ch.mockResolvedValue({ rows: [], columns: ["service", ...columns] });

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      dryRun: true,
      resources: [
        {
          path: "wide.yaml",
          resource: alert("wide", {
            valueColumn: undefined,
            notificationMessage: { title: `\${c3} things on \${service}` },
          }),
        },
      ],
    });

    expect(res.created).toEqual(["wide"]);
    expect(res.note).toMatch(
      /wide\.yaml: the query returns 17 non-label columns but alert events keep at most 16 as evidence, so \$\{c3\} may render empty/,
    );
  });

  // Dev-migration path: an existing CC rule stamped only with everr.name +
  // everr.repoid (no everr.managed, since the marker is retired) must still be
  // recognized as owned and reconciled in place, not treated as a bare
  // power-user rule and left alone / duplicated.
  it("adopts an existing rule tagged everr.name + everr.repoid with no everr.managed marker", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "rule-high-errors",
        version: 7,
        spec: {
          sql: "SELECT service, count() AS count FROM old_logs GROUP BY service",
          interval_secs: 300,
          for_secs: 0,
          label_columns: ["service"],
          value_column: "count",
          severity: "info",
          annotations: {
            [OWN_NAME]: "high-errors",
            [OWN_REPO]: "repo-1",
            "everr.notification.title": `\${value} errors in \${service}`,
            summary: `\${value} errors in \${service}`,
          },
          resolve_after: 1,
          suppressed: false,
        },
      },
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    // Recognized as this rule (matched by name), updated in place rather than
    // deleted + recreated: the id and version are preserved.
    expect(res.created).toEqual([]);
    expect(res.updated).toEqual(["high-errors"]);
    expect(res.deleted).toEqual([]);
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
    const [, id, , version] = mockedUpdateRule.mock.calls[0];
    expect(id).toBe("rule-high-errors");
    expect(version).toBe(7);
  });

  it("leaves an unchanged managed rule alone (no update)", async () => {
    mockedListRules.mockResolvedValue([managedRule("high-errors")]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res).toEqual({
      created: [],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("updates a changed managed rule in place with its version", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        // Different SQL → fingerprint changes.
        sql: "SELECT service, count() AS count FROM old_logs GROUP BY service",
      }),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res).toEqual({
      created: [],
      updated: ["high-errors"],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    // In-place PUT guarded by the stored version — never delete + recreate,
    // which would reset instance state.
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1);
    const [org, id, spec, version] = mockedUpdateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(id).toBe("rule-high-errors");
    expect(version).toBe(3);
    expect(spec.sql).toBe(
      "SELECT service, count() AS count FROM logs GROUP BY service",
    );
    expect(spec.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/rule-high-errors",
    );
    expect(mockedDeleteRule).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("fails the resource clearly when CC reports a version conflict", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        sql: "SELECT service, count() AS count FROM old_logs GROUP BY service",
      }),
    ]);
    mockedUpdateRule.mockRejectedValueOnce(
      new CcApiError(
        409,
        "conflict",
        "rule version mismatch: expected 3, current 4",
      ),
    );

    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "a.yaml", resource: alert() }],
      });
      expect.fail("expected the version conflict to fail the apply");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /a\.yaml: alert "high-errors" was modified concurrently .* re-run apply/,
        ),
      });
    }
  });

  it("deletes a managed rule absent from config", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "x",
        spec: {
          annotations: {
            [OWN_NAME]: "gone",
            [OWN_REPO]: "repo-1",
          },
        },
      },
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [],
    });

    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "x");
    expect(res.deleted).toEqual(["gone"]);
  });

  it("never deletes a bare CC rule (no everr.name) in the same repo", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "p",
        // Owned by repo-1 but no everr.name — a power-user CC rule, never
        // adopted or touched by the AlertRule reconciler.
        spec: { annotations: { [OWN_REPO]: "repo-1" }, severity: "info" },
      },
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [],
    });

    expect(mockedDeleteRule).not.toHaveBeenCalled();
    expect(res.deleted).toEqual([]);
  });

  it("never deletes a managed rule owned by a different repo", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "other",
        spec: {
          annotations: {
            [OWN_NAME]: "elsewhere",
            [OWN_REPO]: "repo-2",
          },
        },
      },
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [],
    });

    expect(mockedDeleteRule).not.toHaveBeenCalled();
    expect(res.deleted).toEqual([]);
  });

  it("rejects duplicate alert names before querying ClickHouse", async () => {
    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          { path: "a.yaml", resource: alert("same") },
          { path: "b.yaml", resource: alert("same") },
        ],
      });
      expect.fail("expected duplicate names to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /duplicate alert "same" \(a\.yaml and b\.yaml\)/,
        ),
      });
    }

    expect(ch).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("rejects invalid schema, intervals, durations, and unsupported variables with path context", async () => {
    const cases: [string, unknown, RegExp][] = [
      ["bad.yaml", { kind: "AlertRule" }, /bad\.yaml: invalid alert rule/],
      [
        "fast.yaml",
        alert("fast", { evaluationInterval: "30s" }),
        /fast\.yaml: invalid evaluationInterval/,
      ],
      [
        "bad-for.yaml",
        alert("bad-for", { for: "5x" }),
        /bad-for\.yaml: invalid for duration "5x"/,
      ],
      [
        "bad-resolve.yaml",
        alert("bad-resolve", { resolveAfter: 0 }),
        /bad-resolve\.yaml: invalid alert rule/,
      ],
      [
        "bad-var.yaml",
        alert("bad", { query: `SELECT \${tenant}` }),
        /bad-var\.yaml: unsupported query variable/,
      ],
    ];
    for (const [path, resource, pattern] of cases) {
      try {
        await applyAlertSpecs({
          namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
          db,
          resources: [{ path, resource }],
        });
        expect.fail(`expected ${path} to fail validation`);
      } catch (error) {
        expect(error).toBeInstanceOf(ApplyValidationError);
        expect(error).toMatchObject({
          message: expect.stringMatching(pattern),
        });
      }
    }
  });

  it("rejects the value placeholder in messages when valueColumn is not set", async () => {
    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          {
            path: "no-value.yaml",
            resource: alert("no-value", { valueColumn: undefined }),
          },
        ],
      });
      expect.fail("expected the value ref to fail validation");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /no-value\.yaml: \$\{value\} requires spec\.valueColumn/,
        ),
      });
    }
  });

  it("rejects instanceLabels columns the query does not return", async () => {
    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          {
            path: "labels.yaml",
            resource: alert("labels", {
              instanceLabels: ["missing"],
              notificationMessage: { title: "plain title" },
            }),
          },
        ],
      });
      expect.fail("expected the missing label column to fail validation");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /labels\.yaml: instanceLabels references column "missing"/,
        ),
      });
    }
  });

  it("rejects a valueColumn the query does not return", async () => {
    ch.mockResolvedValueOnce({ rows: [], columns: ["service"] });

    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "value.yaml", resource: alert() }],
      });
      expect.fail("expected the missing value column to fail validation");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /value\.yaml: valueColumn references column "count"/,
        ),
      });
    }
  });

  it("wraps query errors as apply validation errors with path context", async () => {
    ch.mockRejectedValueOnce(new Error("syntax error"));

    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "query.yaml", resource: alert() }],
      });
      expect.fail("expected query validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /query\.yaml: query failed: syntax error/,
        ),
      });
    }
  });
});
