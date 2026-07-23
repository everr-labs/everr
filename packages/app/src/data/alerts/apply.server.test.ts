import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listAllRules: vi.fn(),
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
import { OWN_REPO } from "./mapping";

// The simple-alert reconciler talks to CC over HTTP and never touches Postgres,
// so the Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

const ch = vi.mocked(querySqlApiWithMeta);
const mockedListRules = cc.listAllRules as ReturnType<typeof vi.fn>;
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

// A CC rule view shape as returned by the rules listing, matching what applying
// the default alert() fixture stores (so the fingerprints are equal). Identity
// (project/slug, live-vs-preview) lives on the rule's first-class `name`/
// `namespace` fields now, not an annotation — only everr.repoid stays there.
function managedRule(name: string, over: Record<string, unknown> = {}) {
  return {
    id: `rule-${name}`,
    version: 3,
    namespace: "",
    name: `default/${name}`,
    spec: {
      sql: "SELECT service, count() AS count FROM logs GROUP BY service",
      interval_secs: 300,
      for_secs: 0,
      label_columns: ["service"],
      value_column: "count",
      severity: "info",
      annotations: {
        [OWN_REPO]: "repo-1",
        summary: `\${value} errors in \${service}`,
        "link.alert": `https://app.example.com/alerts/rules/default/${name}`,
      },
      resolve_after: 1,
      suppressed: false,
      ...over,
    },
  };
}

// A stored PREVIEW copy of the alert() fixture: suppressed, tagged with its
// owning preview registry id on the first-class `namespace` field. The
// project/slug `name` and link.alert are unchanged from the live copy — the
// link target no longer depends on the CC rule id or the live/preview split.
function previewRule(
  name: string,
  previewId: string,
  over: Record<string, unknown> = {},
) {
  const base = managedRule(name);
  return {
    ...base,
    id: `prev-rule-${name}`,
    namespace: previewId,
    spec: {
      ...base.spec,
      suppressed: true,
      ...over,
    },
  };
}

describe("applyAlertSpecs", () => {
  it("creates a managed CC rule with a single call (no follow-up link stamp)", async () => {
    await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    const [org, input] = mockedCreateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(input).toEqual(
      expect.objectContaining({ name: "default/high-errors", namespace: "" }),
    );
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(input.annotations.summary).toBe(`\${value} errors in \${service}`);
    expect(input.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-errors",
    );
    expect(input.interval_secs).toBe(300);
    expect(input.value_column).toBe("count");

    // Identity (project/slug/namespace) is known up front, so create is a
    // single call: no follow-up PUT to stamp a link.
    expect(mockedUpdateRule).not.toHaveBeenCalled();
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
      created: ["default/high-errors"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("preview apply creates a suppressed rule in the preview namespace", async () => {
    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    // Full validation ran (the query was checked against ClickHouse)...
    expect(ch).toHaveBeenCalledTimes(1);
    // ...and the rule was REALLY registered, exactly like a live create but
    // suppressed (evaluated, never notifying) and namespaced to the preview.
    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    const [org, input] = mockedCreateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(input.namespace).toBe("p1");
    expect(input.name).toBe("default/high-errors");
    expect(input.suppressed).toBe(true);
    expect(input.annotations[OWN_REPO]).toBe("repo-1");
    expect(input.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-errors",
    );

    // Single-call create, same as the live path.
    expect(mockedUpdateRule).not.toHaveBeenCalled();

    expect(res.created).toEqual(["default/high-errors"]);
    expect(res.deleted).toEqual([]);
    expect(res.note).toMatch(/suppressed/);
  });

  it("scopes a preview reconcile to rules tagged with ITS preview namespace", async () => {
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

    expect(res.deleted).toEqual(["default/stale"]);
    expect(mockedDeleteRule).toHaveBeenCalledTimes(1);
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "prev-rule-stale");
  });

  it("preview-scopes rules: live and preview copies of the same name coexist, live apply only touches its own", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        // Different SQL → fingerprint changes, so the live apply updates it.
        sql: "SELECT service, count() AS count FROM old_logs GROUP BY service",
      }),
      previewRule("high-errors", "pv-1"),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.created).toEqual([]);
    expect(res.updated).toEqual(["default/high-errors"]);
    expect(res.deleted).toEqual([]);
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1);
    const [, id] = mockedUpdateRule.mock.calls[0];
    // The live rule's id, never the coexisting preview copy's.
    expect(id).toBe("rule-high-errors");
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("a live apply deletes only the live copy when a preview copy of the same name coexists", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors"),
      previewRule("high-errors", "pv-1"),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [],
    });

    expect(mockedDeleteRule).toHaveBeenCalledTimes(1);
    // The live rule's id, never the coexisting preview copy's.
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "rule-high-errors");
    expect(res.deleted).toEqual(["default/high-errors"]);
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
    expect(changed.updated).toEqual(["default/high-errors"]);
    const [, id, spec, version] = mockedUpdateRule.mock.calls[0];
    expect(id).toBe("prev-rule-high-errors");
    expect(version).toBe(3);
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
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
    expect(res.created).toEqual(["default/high-errors"]);
    const [, input] = mockedCreateRule.mock.calls[0];
    expect(input.suppressed).toBe(false);
    expect(input.namespace).toBe("");
  });

  it("dry-run of a first preview apply (no registry row) plans creates without listing CC", async () => {
    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: null },
      db,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.created).toEqual(["default/high-errors"]);
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
    expect(res.created).toEqual(["default/replays"]);
    expect(res.note).toBeUndefined();
    const [, input] = mockedCreateRule.mock.calls[0];
    expect(input.label_columns).toEqual([]);
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

    expect(res.created).toEqual(["default/wide"]);
    expect(res.note).toMatch(
      /wide\.yaml: the query returns 17 non-label columns but alert events keep at most 16 as evidence, so \$\{c3\} may render empty/,
    );
  });

  // A CC rule at the same name/namespace, carrying only everr.repoid (no
  // summary/link annotations previously generated) must still be recognized
  // as owned and reconciled in place, not treated as a bare power-user rule
  // and left alone / duplicated.
  it("adopts an existing rule at the same name/namespace with only everr.repoid set", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "rule-high-errors",
        version: 7,
        namespace: "",
        name: "default/high-errors",
        spec: {
          sql: "SELECT service, count() AS count FROM old_logs GROUP BY service",
          interval_secs: 300,
          for_secs: 0,
          label_columns: ["service"],
          value_column: "count",
          severity: "info",
          annotations: {
            [OWN_REPO]: "repo-1",
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

    // Recognized as this rule (matched by name/namespace), updated in place
    // rather than deleted + recreated: the id and version are preserved.
    expect(res.created).toEqual([]);
    expect(res.updated).toEqual(["default/high-errors"]);
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
      updated: ["default/high-errors"],
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
      "https://app.example.com/alerts/rules/default/high-errors",
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
          /a\.yaml: alert "default\/high-errors" was modified concurrently .* re-run apply/,
        ),
      });
    }
  });

  it("deletes a managed rule absent from config", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "x",
        namespace: "",
        name: "default/gone",
        spec: {
          annotations: {
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
    expect(res.deleted).toEqual(["default/gone"]);
  });

  it("never deletes a bare CC rule with no everr.repoid annotation", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "p",
        namespace: "",
        name: "power-user-rule",
        // No everr.repoid — a power-user CC rule, never adopted or touched by
        // the AlertRule reconciler.
        spec: { annotations: {}, severity: "info" },
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
        namespace: "",
        name: "default/elsewhere",
        spec: {
          annotations: {
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

  it("reports a cross-repo name collision as an ownership conflict (no writes)", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        annotations: {
          [OWN_REPO]: "repo-2",
          summary: `\${value} errors in \${service}`,
        },
      }),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.conflicts).toEqual([
      { project: "default", slug: "high-errors", owner: "repo-2" },
    ]);
    expect(res.created).toEqual([]);
    expect(res.adopted).toEqual([]);
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
  });

  it('reports a UI-created rule name collision with owner ""', async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", { annotations: {} }),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.conflicts).toEqual([
      { project: "default", slug: "high-errors", owner: "" },
    ]);
  });

  it("adopts a colliding foreign rule in place with adopt: true", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        annotations: {
          [OWN_REPO]: "repo-2",
          summary: `\${value} errors in \${service}`,
        },
      }),
    ]);

    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
      db,
      adopt: true,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.conflicts).toEqual([]);
    expect(res.adopted).toEqual(["default/high-errors"]);
    expect(res.created).toEqual([]);
    // Ownership transfers via a version-guarded update on the existing id, so
    // the rule's id and instance state survive the takeover.
    expect(mockedCreateRule).not.toHaveBeenCalled();
    const [, id, spec, version] = mockedUpdateRule.mock.calls[0];
    expect(id).toBe("rule-high-errors");
    expect(version).toBe(3);
    expect(spec.annotations[OWN_REPO]).toBe("repo-1");
  });

  it("translates a create-race 409 into a friendly ApplyValidationError", async () => {
    mockedCreateRule.mockRejectedValueOnce(
      new CcApiError(409, "conflict", "rule name already exists"),
    );

    try {
      await applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "a.yaml", resource: alert() }],
      });
      expect.fail("expected the create race to fail as a validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).not.toBeInstanceOf(CcApiError);
      expect(error).toMatchObject({
        message: expect.stringMatching(/a\.yaml:.*default\/high-errors/),
      });
    }
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
