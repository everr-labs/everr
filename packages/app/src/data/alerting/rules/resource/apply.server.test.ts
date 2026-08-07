import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/alerting/rules/repository", () => ({
  listAllRules: vi.fn(),
  createRule: vi.fn(),
  adoptRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
}));

vi.mock("@/data/alerting/delivery/repository", () => ({
  listChannels: vi.fn(),
}));

vi.mock("@/lib/clickhouse", () => ({ querySqlApiWithMeta: vi.fn() }));

// The reconciler builds absolute notification links from the app origin; tests
// must not depend on real (validated) server env.
vi.mock("@/env/auth", () => ({
  authEnv: { BETTER_AUTH_URL: "https://app.example.com" },
}));

import { listChannels } from "@/data/alerting/delivery/repository";
import { AlertingError } from "@/data/alerting/errors";
import * as alerting from "@/data/alerting/rules/repository";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { DbExecutor } from "@/db/client";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import { applyAlertSpecs } from "./apply.server";

// These tests mock the repository, so the reconciler executor is unused.
const db = {} as unknown as DbExecutor;

const ch = vi.mocked(querySqlApiWithMeta);
const mockedListRules = alerting.listAllRules as ReturnType<typeof vi.fn>;
const mockedListChannels = listChannels as ReturnType<typeof vi.fn>;
const mockedCreateRule = alerting.createRule as ReturnType<typeof vi.fn>;
const mockedAdoptRule = alerting.adoptRule as ReturnType<typeof vi.fn>;
const mockedUpdateRule = alerting.updateRule as ReturnType<typeof vi.fn>;
const mockedDeleteRule = alerting.deleteRule as ReturnType<typeof vi.fn>;

// The two namespaces every apply below runs in: this repo's live state, or one
// of its previews (id null while a first apply is still being dry-run).
const live = { orgId: "o", repoid: "repo-1", kind: "live" } as const;
const preview = (id: string | null) =>
  ({ orgId: "o", repoid: "repo-1", kind: "preview", id }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  ch.mockResolvedValue({
    rows: [{ service: "api", value: 1 }],
    columns: ["service", "value"],
    columnTypes: ["String", "UInt64"],
  });
  mockedListRules.mockResolvedValue([]);
  mockedListChannels.mockResolvedValue([]);
  mockedCreateRule.mockResolvedValue({ id: "new-rule", version: 1 });
  mockedAdoptRule.mockResolvedValue({ id: "new-rule", version: 4 });
  mockedUpdateRule.mockResolvedValue({ id: "new-rule", version: 2 });
});

function alert(name = "high-errors", overrides = {}) {
  return {
    kind: "AlertRule",
    metadata: { name },
    spec: {
      evaluationInterval: "5m",
      notificationMessage: { title: `\${value} errors in \${service}` },
      query: "SELECT service, count() AS value FROM logs GROUP BY service",
      instanceLabels: ["service"],
      condition: { operator: "gt", threshold: 0 },
      ...overrides,
    },
  };
}

// Matches the stored form of the default alert fixture.
function managedRule(name: string, over: Record<string, unknown> = {}) {
  const { repoid = "repo-1", ...specOver } = over;
  return {
    id: `rule-${name}`,
    version: 3,
    previewId: null,
    repoid,
    name: `default/${name}`,
    notification_channels: [],
    spec: {
      sql: "SELECT service, count() AS value FROM logs GROUP BY service",
      interval_secs: 300,
      for_secs: 0,
      label_columns: ["service"],
      condition: { operator: "gt", threshold: 0 },
      severity: "info",
      annotations: {
        summary: `\${value} errors in \${service}`,
        "link.alert": `https://app.example.com/alerts/rules/default/${name}`,
      },
      resolve_after: 1,
      suppressed: false,
      ...specOver,
    },
  };
}

// A suppressed preview copy of the alert fixture.
function previewRule(
  name: string,
  previewId: string,
  over: Record<string, unknown> = {},
) {
  const base = managedRule(name);
  return {
    ...base,
    id: `prev-rule-${name}`,
    previewId,
    spec: {
      ...base.spec,
      suppressed: true,
      ...over,
    },
  };
}

// The stored rule with a different query, so its fingerprint differs from the
// alert() fixture and the reconcile plans an update.
const CHANGED_SQL =
  "SELECT service, count() AS count FROM old_logs GROUP BY service";

describe("applyAlertSpecs", () => {
  it("creates a managed rule with its identity and links", async () => {
    await applyAlertSpecs({
      namespace: live,
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    const [org, input] = mockedCreateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(input).toEqual(
      expect.objectContaining({ name: "default/high-errors", previewId: null }),
    );
    expect(input.suppressed).toBe(false);
    expect(input.repoid).toBe("repo-1");
    expect(input.annotations.summary).toBe(`\${value} errors in \${service}`);
    expect(input.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-errors",
    );
    expect(input.interval_secs).toBe(300);
    expect(input.condition).toEqual({
      operator: "gt",
      threshold: 0,
    });

    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("resolves explicit notification channels before creating the rule", async () => {
    mockedListChannels.mockResolvedValue([
      { id: "channel-1", tenant: "o", name: "team-slack", config: {} },
    ]);

    await applyAlertSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "direct.alert.yaml",
          resource: alert("direct", {
            notification: { channels: ["team-slack"] },
          }),
        },
      ],
    });

    expect(mockedCreateRule).toHaveBeenCalledWith(
      "o",
      expect.objectContaining({ notification_channels: ["team-slack"] }),
    );
  });

  it("rejects unknown explicit notification channels during dry-run", async () => {
    await expect(
      applyAlertSpecs({
        namespace: live,
        db,
        dryRun: true,
        resources: [
          {
            path: "direct.alert.yaml",
            resource: alert("direct", {
              notification: { channels: ["missing"] },
            }),
          },
        ],
      }),
    ).rejects.toThrow(
      "direct.alert.yaml: unknown notification channels: missing",
    );
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("dry-run plans without mutating", async () => {
    const res = await applyAlertSpecs({
      namespace: live,
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
      namespace: preview("p1"),
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    // Full validation ran (the query was checked against ClickHouse)...
    expect(ch).toHaveBeenCalledTimes(1);
    // ...and the rule was REALLY registered, exactly like a live create but
    // suppressed (evaluated, never notifying) and namespaced to the preview.
    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    const [, input] = mockedCreateRule.mock.calls[0];
    expect(input.previewId).toBe("p1");
    expect(input.name).toBe("default/high-errors");
    expect(input.suppressed).toBe(true);
    expect(input.repoid).toBe("repo-1");
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
      namespace: preview("p1"),
      db,
      resources: [],
    });

    expect(res.deleted).toEqual(["default/stale"]);
    expect(mockedDeleteRule).toHaveBeenCalledTimes(1);
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "prev-rule-stale");
  });

  it("a live apply updates and prunes only the live copy when a preview copy of the same name coexists", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", { sql: CHANGED_SQL }),
      previewRule("high-errors", "pv-1"),
    ]);

    const updated = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(updated.created).toEqual([]);
    expect(updated.updated).toEqual(["default/high-errors"]);
    expect(updated.deleted).toEqual([]);
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1);
    // The live rule's id, never the coexisting preview copy's.
    expect(mockedUpdateRule.mock.calls[0][1]).toBe("rule-high-errors");

    mockedListRules.mockResolvedValue([
      managedRule("high-errors"),
      previewRule("high-errors", "pv-1"),
    ]);
    const pruned = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [],
    });

    expect(pruned.deleted).toEqual(["default/high-errors"]);
    expect(mockedDeleteRule).toHaveBeenCalledTimes(1);
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "rule-high-errors");
  });

  it("leaves an unchanged preview rule alone and updates a changed one in place", async () => {
    mockedListRules.mockResolvedValue([previewRule("high-errors", "p1")]);
    const unchanged = await applyAlertSpecs({
      namespace: preview("p1"),
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });
    expect(unchanged.created).toEqual([]);
    expect(unchanged.updated).toEqual([]);
    expect(unchanged.deleted).toEqual([]);
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();

    mockedListRules.mockResolvedValue([
      previewRule("high-errors", "p1", { sql: CHANGED_SQL }),
    ]);
    const changed = await applyAlertSpecs({
      namespace: preview("p1"),
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });
    expect(changed.updated).toEqual(["default/high-errors"]);
    const [, id, spec, version] = mockedUpdateRule.mock.calls[0];
    expect(id).toBe("prev-rule-high-errors");
    expect(version).toBe(3);
    expect(spec.suppressed).toBe(true);
    expect(spec.annotations).not.toHaveProperty("everr.repoid");
  });

  it("live apply never adopts or prunes preview rules (it creates its own)", async () => {
    // Only a preview copy of "high-errors" exists: a live apply must not adopt
    // it. It creates a live rule. An empty live apply must not
    // prune it.
    mockedListRules.mockResolvedValue([previewRule("high-errors", "p1")]);

    const empty = await applyAlertSpecs({ namespace: live, db, resources: [] });
    expect(empty.deleted).toEqual([]);
    expect(mockedDeleteRule).not.toHaveBeenCalled();

    const res = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });
    expect(res.created).toEqual(["default/high-errors"]);
    const [, input] = mockedCreateRule.mock.calls[0];
    expect(input.suppressed).toBe(false);
    expect(input.previewId).toBeNull();
  });

  it("plans first-preview creates without listing stored rules", async () => {
    const res = await applyAlertSpecs({
      namespace: preview(null),
      db,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(res.created).toEqual(["default/high-errors"]);
    expect(res.deleted).toEqual([]);
    // A preview without an id has no existing resource scope.
    expect(mockedListRules).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("fails a preview apply whose template references a column the query does not return", async () => {
    // The result-dependent validation is not skipped for previews: a broken
    // config fails before the change is ever merged.
    try {
      await applyAlertSpecs({
        namespace: preview("p1"),
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
          /labels\.yaml: \$\{nope\} is not a column of the query result.*\(available: service, value\)/,
        ),
      });
    }

    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("infers the implicit string-column identity when instanceLabels is omitted", async () => {
    ch.mockResolvedValue({
      rows: [{ value: 3, last_error: "boom" }],
      columns: ["value", "last_error"],
      columnTypes: ["UInt64", "String"],
    });

    const res = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "replays.yaml",
          resource: alert("replays", {
            instanceLabels: undefined,
            condition: { operator: "gt", threshold: 0 },
            notificationMessage: {
              title: `\${value} replays failed`,
              description: `last error: \${last_error}`,
            },
            query: "SELECT count() AS value, any(e) AS last_error",
          }),
        },
      ],
    });

    // String columns become the instance identity when instanceLabels is omitted.
    expect(res.created).toEqual(["default/replays"]);
    expect(res.note).toBeUndefined();
    const [, input] = mockedCreateRule.mock.calls[0];
    expect(input.label_columns).toEqual(["last_error"]);
  });

  it("never infers non-string columns, and explicit instanceLabels win", async () => {
    ch.mockResolvedValue({
      rows: [],
      columns: ["service", "region", "value"],
      columnTypes: ["LowCardinality(String)", "Nullable(String)", "UInt64"],
    });

    await applyAlertSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "spread.yaml",
          resource: alert("spread", {
            instanceLabels: undefined,
            notificationMessage: { title: `errors in \${service}` },
          }),
        },
      ],
    });
    expect(mockedCreateRule.mock.calls[0][1].label_columns).toEqual([
      "service",
      "region",
    ]);

    // Same query result, but the spec names its own identity: the inferred
    // columns are ignored entirely.
    await applyAlertSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "explicit.yaml",
          resource: alert("explicit", {
            instanceLabels: ["region"],
            notificationMessage: { title: `errors in \${region}` },
          }),
        },
      ],
    });
    expect(mockedCreateRule.mock.calls[1][1].label_columns).toEqual(["region"]);
  });

  it("warns without failing when references exceed the 16-column evidence cap", async () => {
    const columns = ["value", ...Array.from({ length: 16 }, (_, i) => `c${i}`)];
    ch.mockResolvedValue({
      rows: [],
      columns: ["service", ...columns],
      columnTypes: ["String", ...columns.map(() => "UInt64")],
    });

    const res = await applyAlertSpecs({
      namespace: live,
      db,
      dryRun: true,
      resources: [
        {
          path: "wide.yaml",
          resource: alert("wide", {
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

  it("leaves an unchanged managed rule alone and updates a changed one in place with its version", async () => {
    mockedListRules.mockResolvedValue([managedRule("high-errors")]);
    const unchanged = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(unchanged).toEqual({
      created: [],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();

    mockedListRules.mockResolvedValue([
      managedRule("high-errors", { sql: CHANGED_SQL }),
    ]);
    const changed = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [{ path: "a.yaml", resource: alert() }],
    });

    expect(changed).toEqual({
      created: [],
      updated: ["default/high-errors"],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    // Use an in-place PUT with the stored version. Do not delete and recreate,
    // which would reset instance state.
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1);
    const [org, id, spec, version] = mockedUpdateRule.mock.calls[0];
    expect(org).toBe("o");
    expect(id).toBe("rule-high-errors");
    expect(version).toBe(3);
    expect(spec.sql).toBe(
      "SELECT service, count() AS value FROM logs GROUP BY service",
    );
    expect(spec.annotations["link.alert"]).toBe(
      "https://app.example.com/alerts/rules/default/high-errors",
    );
    expect(mockedDeleteRule).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("fails the resource clearly on a version conflict", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", { sql: CHANGED_SQL }),
    ]);
    mockedUpdateRule.mockRejectedValueOnce(
      new AlertingError(
        409,
        "conflict",
        "rule version mismatch: expected 3, current 4",
      ),
    );

    try {
      await applyAlertSpecs({
        namespace: live,
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

  it("prunes this repo's rules absent from config, never other repos' rules", async () => {
    mockedListRules.mockResolvedValue([
      {
        id: "x",
        repoid: "repo-1",
        previewId: null,
        name: "default/gone",
        spec: { annotations: {} },
      },
      {
        id: "p",
        repoid: "repo-ui",
        previewId: null,
        name: "power-user-rule",
        spec: { annotations: {}, severity: "info" },
      },
      {
        id: "other",
        repoid: "repo-2",
        previewId: null,
        name: "default/elsewhere",
        spec: { annotations: {} },
      },
    ]);

    const res = await applyAlertSpecs({ namespace: live, db, resources: [] });

    expect(res.deleted).toEqual(["default/gone"]);
    expect(mockedDeleteRule).toHaveBeenCalledTimes(1);
    expect(mockedDeleteRule).toHaveBeenCalledWith("o", "x");
  });

  it("reports cross-repo name collisions as ownership conflicts (no writes)", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        repoid: "repo-2",
        annotations: {
          summary: `\${value} errors in \${service}`,
        },
      }),
      managedRule("ui-made", { repoid: "repo-ui" }),
    ]);

    const res = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [
        { path: "a.yaml", resource: alert() },
        { path: "b.yaml", resource: alert("ui-made") },
      ],
    });

    expect(res.conflicts).toEqual([
      { project: "default", slug: "high-errors", owner: "repo-2" },
      { project: "default", slug: "ui-made", owner: "repo-ui" },
    ]);
    expect(res.created).toEqual([]);
    expect(res.adopted).toEqual([]);
    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
  });

  it("adopts a colliding foreign rule in place with adopt: true", async () => {
    mockedListRules.mockResolvedValue([
      managedRule("high-errors", {
        repoid: "repo-2",
        annotations: {
          summary: `\${value} errors in \${service}`,
        },
      }),
    ]);

    const res = await applyAlertSpecs({
      namespace: live,
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
    const [, id, owner, version, spec] = mockedAdoptRule.mock.calls[0];
    expect(id).toBe("rule-high-errors");
    expect(owner).toBe("repo-1");
    expect(version).toBe(3);
    expect(spec.annotations).not.toHaveProperty("everr.repoid");
    expect(mockedUpdateRule).not.toHaveBeenCalled();
  });

  it("translates a create-race 409 into a friendly ApplyValidationError", async () => {
    mockedCreateRule.mockRejectedValueOnce(
      new AlertingError(409, "conflict", "rule name already exists"),
    );

    try {
      await applyAlertSpecs({
        namespace: live,
        db,
        resources: [{ path: "a.yaml", resource: alert() }],
      });
      expect.fail("expected the create race to fail as a validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).not.toBeInstanceOf(AlertingError);
      expect(error).toMatchObject({
        message: expect.stringMatching(/a\.yaml:.*default\/high-errors/),
      });
    }
  });

  it("keys duplicate detection on project/slug, rejecting dupes before querying ClickHouse", async () => {
    // The same slug in two projects is two resources, not a duplicate.
    const res = await applyAlertSpecs({
      namespace: live,
      db,
      resources: [
        {
          path: "a.yaml",
          resource: {
            ...alert("high-errors"),
            metadata: { name: "high-errors", project: "payments" },
          },
        },
        {
          path: "b.yaml",
          resource: {
            ...alert("high-errors"),
            metadata: { name: "high-errors", project: "checkout" },
          },
        },
      ],
    });
    expect(res.created).toEqual([
      "payments/high-errors",
      "checkout/high-errors",
    ]);
    expect(mockedCreateRule).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    try {
      await applyAlertSpecs({
        namespace: live,
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
          /duplicate alert "default\/same" \(a\.yaml and b\.yaml\)/,
        ),
      });
    }
    expect(ch).not.toHaveBeenCalled();
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("reports every validation failure with its file path and nothing written", async () => {
    const cases: {
      path: string;
      resource: unknown;
      pattern: RegExp;
      columns?: [string[], string[]];
      queryError?: string;
    }[] = [
      {
        path: "bad.yaml",
        resource: { kind: "AlertRule" },
        pattern: /bad\.yaml: invalid alert rule/,
      },
      {
        path: "fast.yaml",
        resource: alert("fast", { evaluationInterval: "30s" }),
        pattern: /fast\.yaml: invalid evaluationInterval/,
      },
      {
        path: "bad-for.yaml",
        resource: alert("bad-for", { for: "5x" }),
        pattern: /bad-for\.yaml: invalid for duration "5x"/,
      },
      {
        path: "bad-resolve.yaml",
        resource: alert("bad-resolve", { resolveAfter: 0 }),
        pattern: /bad-resolve\.yaml: invalid alert rule/,
      },
      {
        path: "bad-var.yaml",
        resource: alert("bad", { query: `SELECT \${tenant}` }),
        pattern: /bad-var\.yaml: unsupported query variable/,
      },
      {
        path: "no-condition.yaml",
        resource: alert("no-condition", { condition: undefined }),
        pattern: /no-condition\.yaml: invalid alert rule/,
      },
      {
        path: "labels.yaml",
        resource: alert("labels", {
          instanceLabels: ["missing"],
          notificationMessage: { title: "plain title" },
        }),
        pattern: /labels\.yaml: instanceLabels references column "missing"/,
      },
      {
        path: "value.yaml",
        resource: alert(),
        columns: [["service"], ["String"]],
        pattern:
          /value\.yaml: alert query must return a numeric column named "value"/,
      },
      {
        path: "condition-type.yaml",
        resource: alert("condition-type", {
          condition: { operator: "eq", threshold: 1 },
          instanceLabels: undefined,
          notificationMessage: { title: "plain title" },
        }),
        pattern:
          /condition-type\.yaml: alert query column "value" must be numeric, got String/,
        columns: [["value"], ["String"]],
      },
      {
        path: "query.yaml",
        resource: alert(),
        queryError: "syntax error",
        pattern: /query\.yaml: query failed: syntax error/,
      },
    ];

    for (const { path, resource, pattern, columns, queryError } of cases) {
      if (queryError) ch.mockRejectedValueOnce(new Error(queryError));
      else if (columns) {
        ch.mockResolvedValueOnce({
          rows: [],
          columns: columns[0],
          columnTypes: columns[1],
        });
      }
      try {
        await applyAlertSpecs({
          namespace: live,
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

    expect(mockedCreateRule).not.toHaveBeenCalled();
    expect(mockedUpdateRule).not.toHaveBeenCalled();
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });
});
