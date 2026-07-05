import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  deleteRule: vi.fn(),
}));

vi.mock("@/lib/clickhouse", () => ({ querySqlApiWithMeta: vi.fn() }));

import { ApplyValidationError } from "@/data/as-code/errors";
import * as cc from "@/data/cc/client";
import type { DbExecutor } from "@/db/client";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import { applyAlertSpecs } from "./apply.server";
import { MANAGED_SIMPLE, OWN_MANAGED, OWN_NAME, OWN_REPO } from "./mapping";

// The simple-alert reconciler talks to CC over HTTP and never touches Postgres,
// so the Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

const ch = vi.mocked(querySqlApiWithMeta);
const mockedListRules = cc.listRules as ReturnType<typeof vi.fn>;
const mockedCreateRule = cc.createRule as ReturnType<typeof vi.fn>;
const mockedDeleteRule = cc.deleteRule as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  ch.mockResolvedValue({
    rows: [{ service: "api", count: 1 }],
    columns: ["service", "count"],
  });
  mockedListRules.mockResolvedValue([]);
});

function alert(name = "high-errors", overrides = {}) {
  return {
    kind: "AlertRule",
    metadata: { name },
    spec: {
      evaluationInterval: "5m",
      notificationMessage: { title: `\${count} errors in \${service}` },
      query: "SELECT service, count() AS count FROM logs GROUP BY service",
      ...overrides,
    },
  };
}

// A CC rule view shape as returned by listRules (only the fields the reconciler
// reads: id + spec.annotations).
function managedRule(name: string, over: Record<string, unknown> = {}) {
  return {
    id: `rule-${name}`,
    spec: {
      sql: "SELECT service, count() AS count FROM logs GROUP BY service",
      interval_secs: 300,
      for_secs: 0,
      label_columns: [],
      value_column: null,
      severity: "info",
      annotations: {
        [OWN_NAME]: name,
        [OWN_REPO]: "repo-1",
        [OWN_MANAGED]: MANAGED_SIMPLE,
        "everr.notification.title": "${count} errors in ${service}",
      },
      resolve_after: 1,
      ...over,
    },
  };
}

describe("applyAlertSpecs", () => {
  it("creates a managed CC rule with ownership annotations", async () => {
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
    expect(spec.annotations[OWN_MANAGED]).toBe(MANAGED_SIMPLE);
    expect(spec.interval_secs).toBe(300);
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
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("is a no-op on a preview namespace (CC has no preview overlay)", async () => {
    const res = await applyAlertSpecs({
      namespace: { orgId: "o", repoid: "repo-1", kind: "preview", id: "p1" },
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
    expect(mockedListRules).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("leaves an unchanged managed rule alone (no delete+recreate)", async () => {
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
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("updates a changed managed rule via delete + recreate", async () => {
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
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "rule-high-errors");
    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
  });

  it("deletes a managed rule absent from config", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "x",
        spec: {
          annotations: {
            [OWN_NAME]: "gone",
            [OWN_REPO]: "repo-1",
            [OWN_MANAGED]: MANAGED_SIMPLE,
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

  it("never deletes a power-user rule (no managed marker) in the same repo", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "p",
        // Owned by repo-1 but NOT everr.managed="simple" — a CCAlertRule.
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
            [OWN_MANAGED]: MANAGED_SIMPLE,
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
    await expect(
      applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          { path: "a.yaml", resource: alert("same") },
          { path: "b.yaml", resource: alert("same") },
        ],
      }),
    ).rejects.toThrow(/duplicate alert "same" \(a\.yaml and b\.yaml\)/);

    expect(ch).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("rejects invalid schema, intervals, and unsupported variables with path context", async () => {
    await expect(
      applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "bad.yaml", resource: { kind: "AlertRule" } }],
      }),
    ).rejects.toThrow(/bad\.yaml: invalid alert rule/);

    await expect(
      applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          {
            path: "fast.yaml",
            resource: alert("fast", { evaluationInterval: "30s" }),
          },
        ],
      }),
    ).rejects.toThrow(/fast\.yaml: invalid evaluationInterval/);

    await expect(
      applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          {
            path: "bad-var.yaml",
            resource: alert("bad", { query: `SELECT \${tenant}` }),
          },
        ],
      }),
    ).rejects.toThrow(/bad-var\.yaml: unsupported query variable/);
  });

  it("rejects instanceLabels columns the query does not return", async () => {
    await expect(
      applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          {
            path: "labels.yaml",
            resource: alert("labels", { instanceLabels: ["missing"] }),
          },
        ],
      }),
    ).rejects.toThrow(
      /labels\.yaml: instanceLabels references column "missing"/,
    );
  });

  it("validates notification columns even when the query returns zero rows", async () => {
    ch.mockResolvedValueOnce({ rows: [], columns: ["count"] });

    await expect(
      applyAlertSpecs({
        namespace: { orgId: "o", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "missing-column.yaml", resource: alert() }],
      }),
    ).rejects.toThrow(
      /missing-column\.yaml: \$\{service\} references column "service"/,
    );
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
