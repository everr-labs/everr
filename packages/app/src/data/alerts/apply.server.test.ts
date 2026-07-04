import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";
import { db } from "@/db/client";
import { querySqlApiWithMeta } from "@/lib/clickhouse";

let insertValues: unknown[] = [];
let updateSets: unknown[] = [];
let deleteCalled = false;

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => Promise.resolve([])),
  };
  const updateChain = {
    set: vi.fn((values: unknown) => {
      updateSets.push(values);
      return updateChain;
    }),
    where: vi.fn(() => []),
  };
  const insertChain = {
    values: vi.fn((values: unknown) => {
      insertValues.push(values);
      return insertChain;
    }),
  };
  const deleteChain = {
    where: vi.fn(() => {
      deleteCalled = true;
      return [];
    }),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
  isNull: vi.fn((col: unknown) => ({ op: "isNull", col })),
  sql: vi.fn(() => ({ op: "sql" })),
}));

vi.mock("@/db/schema", () => ({
  alertDefinitions: {
    organizationId: "organization_id",
    repoid: "repoid",
    previewId: "preview_id",
    slug: "slug",
    evaluationIntervalSeconds: "evaluation_interval_seconds",
    document: "document",
    parsedQuery: "parsed_query",
    notificationTitleTemplate: "summary_template",
    notificationDescriptionTemplate: "description_template",
    nextEvaluationAt: "next_evaluation_at",
    scheduleJitterSeconds: "schedule_jitter_seconds",
    configFilePath: "config_file_path",
    sourceLink: "source_link",
    project: "project",
    runbookProject: "runbook_project",
    runbookSlug: "runbook_slug",
    createdAt: "created_at",
    updatedAt: "updated_at",
    deletedAt: "deleted_at",
    active: "active",
    lastEvaluationStatus: "last_evaluation_status",
    lastEvaluationError: "last_evaluation_error",
    currentState: "current_state",
    lastEvaluatedAt: "last_evaluated_at",
    lastFiredAt: "last_fired_at",
    lastResolvedAt: "last_resolved_at",
    lastSeenAt: "last_seen_at",
    lastRowCount: "last_row_count",
    lastEvidenceSnapshot: "last_evidence_snapshot",
    instanceLabelColumns: "instance_label_columns",
  },
}));

vi.mock("@/lib/clickhouse", () => ({
  querySqlApiWithMeta: vi.fn(),
}));

import { applyAlertSpecs } from "./apply.server";

const mockedDb = vi.mocked(db);
const mockedQuerySqlApiWithMeta = vi.mocked(querySqlApiWithMeta);

beforeEach(() => {
  vi.clearAllMocks();
  insertValues = [];
  updateSets = [];
  deleteCalled = false;
  mockedQuerySqlApiWithMeta.mockResolvedValue({
    rows: [],
    columns: ["service", "count"],
  });
});

function mockApplySelect(rows: unknown[]) {
  mockedDb.select.mockImplementationOnce(
    () =>
      ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }) as unknown as ReturnType<typeof mockedDb.select>,
  );
}

function alert(name = "high-errors", overrides = {}) {
  return {
    kind: "AlertRule",
    metadata: { name },
    spec: {
      display: {
        name: "High errors",
        description: "Routes with elevated errors.",
      },
      evaluationInterval: "5m",
      notificationMessage: {
        title: `\${count} errors in \${service}`,
        description: `service \${service}`,
      },
      query:
        "SELECT service, count() AS count FROM logs WHERE timestamp > now() - INTERVAL 15 MINUTE GROUP BY service",
      ...overrides,
    },
  };
}

describe("applyAlertSpecs", () => {
  it("validates, renders, and returns a dry-run diff without writes", async () => {
    mockApplySelect([]);

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      dryRun: true,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result).toEqual({
      created: ["high-errors"],
      updated: [],
      deleted: [],
      adopted: [],
      conflicts: [],
    });
    expect(mockedQuerySqlApiWithMeta).toHaveBeenCalledWith(
      expect.stringContaining("INTERVAL 15 MINUTE"),
      "org-1",
    );
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("reports a cross-repo conflict when another repo owns the alert name", async () => {
    mockApplySelect([]); // scope: no existing rows → create
    // The foreign-owner probe finds repo-2 already owns default/high-errors live.
    mockApplySelect([
      { project: "default", slug: "high-errors", owner: "repo-2" },
    ]);
    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      dryRun: true,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });
    expect(result.created).toEqual([]);
    expect(result.adopted).toEqual([]);
    expect(result.conflicts).toEqual([
      { project: "default", slug: "high-errors", owner: "repo-2" },
    ]);
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("adopts a conflicting alert, transferring ownership and resetting runtime state", async () => {
    mockApplySelect([]); // scope
    mockApplySelect([
      { project: "default", slug: "high-errors", owner: "repo-2" },
    ]);
    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      adopt: true,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });
    expect(result.adopted).toEqual(["high-errors"]);
    expect(result.conflicts).toEqual([]);
    expect(result.created).toEqual([]);
    expect(mockedDb.insert).not.toHaveBeenCalled();
    // Ownership transfer: an update setting the new repoid + reset runtime state.
    expect(updateSets).toEqual([
      expect.objectContaining({ repoid: "repo-1", currentState: "unknown" }),
    ]);
  });

  it("creates active valid alerts and persists source/path metadata", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValueOnce({
      rows: [{ service: "api", count: 3 }],
      columns: ["service", "count"],
    });
    mockApplySelect([]);

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      source: {
        remote: "git@github.com:everr/example.git",
        commitSha: "abc123",
      },
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result.created).toEqual(["high-errors"]);
    expect(mockedDb.insert).toHaveBeenCalledOnce();
    expect(insertValues).toHaveLength(1);
    const batch = insertValues[0] as Record<string, unknown>[];
    expect(batch).toHaveLength(1);
    const created = batch[0];
    expect(created).toMatchObject({
      organizationId: "org-1",
      repoid: "repo-1",
      previewId: null,
      slug: "high-errors",
      evaluationIntervalSeconds: 300,
      document: alert(),
      parsedQuery: expect.stringContaining("INTERVAL 15 MINUTE"),
      notificationTitleTemplate: `\${count} errors in \${service}`,
      notificationDescriptionTemplate: `service \${service}`,
      configFilePath: "alerts/high-errors.yaml",
      sourceLink:
        "https://github.com/everr/example/blob/abc123/alerts/high-errors.yaml",
      active: true,
    });
    expect(created).not.toHaveProperty("currentState");
    expect(created).not.toHaveProperty("lastEvaluatedAt");
    expect(created).not.toHaveProperty("lastFiredAt");
    expect(created).not.toHaveProperty("lastSeenAt");
    expect(created).not.toHaveProperty("lastRowCount");
    expect(created).not.toHaveProperty("lastEvidenceSnapshot");
  });

  it("updates changed alerts and deletes missing alerts", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        project: "default",
        evaluationIntervalSeconds: 60,
        document: {},
        parsedQuery: "SELECT 1",
        notificationTitleTemplate: "old",
        notificationDescriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "old.yaml",
        sourceLink: "",
        active: true,
        currentState: "resolved",
        lastRowCount: 0,
      },
      {
        slug: "stale",
        project: "default",
        evaluationIntervalSeconds: 300,
        document: {},
        parsedQuery: "SELECT 1",
        notificationTitleTemplate: "old",
        notificationDescriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "stale.yaml",
        sourceLink: "",
        active: true,
        currentState: "resolved",
        lastRowCount: 0,
      },
    ]);

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result).toEqual({
      created: [],
      updated: ["high-errors"],
      deleted: ["stale"],
      adopted: [],
      conflicts: [],
    });
    expect(updateSets).toEqual([expect.objectContaining({ active: true })]);
    expect(deleteCalled).toBe(true);
    expect(eq).toHaveBeenCalledWith("repoid", "repo-1");
  });

  it("reactivates a deactivated alert when its rule is re-applied", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        project: "default",
        evaluationIntervalSeconds: 300,
        document: {},
        parsedQuery: "SELECT 1",
        notificationTitleTemplate: "old",
        notificationDescriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "alerts/high-errors.yaml",
        sourceLink: "",
        active: false,
      },
    ]);

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result.updated).toEqual(["high-errors"]);
    expect(deleteCalled).toBe(false);
    expect(updateSets[0]).toMatchObject({
      active: true,
      currentState: "unknown",
    });
  });

  it("rejects duplicate alert names before querying ClickHouse", async () => {
    await expect(
      applyAlertSpecs({
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
        db,
        resources: [
          { path: "a.yaml", resource: alert("same") },
          { path: "b.yaml", resource: alert("same") },
        ],
      }),
    ).rejects.toThrow(
      /duplicate alert "same" in project "default" \(a\.yaml and b\.yaml\)/,
    );

    expect(mockedQuerySqlApiWithMeta).not.toHaveBeenCalled();
  });

  it("resets runtime state when reviving an inactive alert", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        project: "default",
        evaluationIntervalSeconds: 300,
        document: {},
        parsedQuery: "SELECT 1",
        notificationTitleTemplate: "old",
        notificationDescriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "old.yaml",
        sourceLink: "",
        active: false,
      },
    ]);

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result.updated).toEqual(["high-errors"]);
    expect(updateSets[0]).toMatchObject({
      active: true,
      currentState: "unknown",
      lastEvaluatedAt: null,
      lastFiredAt: null,
      lastResolvedAt: null,
      lastSeenAt: null,
      lastRowCount: 0,
      lastEvidenceSnapshot: [],
      firingInstanceCount: 0,
    });
  });

  it("resets runtime state when query or instance labels change", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        project: "default",
        evaluationIntervalSeconds: 300,
        document: {},
        parsedQuery: "SELECT old_service AS service",
        notificationTitleTemplate: `\${count} errors in \${service}`,
        notificationDescriptionTemplate: `service \${service}`,
        instanceLabelColumns: ["old_service"],
        scheduleJitterSeconds: 0,
        configFilePath: "alerts/high-errors.yaml",
        sourceLink: "",
        active: true,
      },
    ]);

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [
        {
          path: "alerts/high-errors.yaml",
          resource: alert("high-errors", { instanceLabels: ["service"] }),
        },
      ],
    });

    expect(result.updated).toEqual(["high-errors"]);
    expect(updateSets[0]).toMatchObject({
      active: true,
      currentState: "unknown",
      lastEvaluatedAt: null,
      lastRowCount: 0,
      lastEvidenceSnapshot: [],
      firingInstanceCount: 0,
    });
  });

  it("rejects invalid schema, intervals, and unsupported variables with path context", async () => {
    await expect(
      applyAlertSpecs({
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "bad.yaml", resource: { kind: "AlertRule" } }],
      }),
    ).rejects.toThrow(/bad\.yaml: invalid alert rule/);

    await expect(
      applyAlertSpecs({
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
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
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
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
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
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

  it("persists instanceLabelColumns on create", async () => {
    mockApplySelect([]);

    await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [
        {
          path: "alerts/high-errors.yaml",
          resource: alert("high-errors", { instanceLabels: ["service"] }),
        },
      ],
    });

    expect(insertValues[0]).toMatchObject([
      { instanceLabelColumns: ["service"] },
    ]);
  });

  it("validates notification columns even when the query returns zero rows", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValueOnce({
      rows: [],
      columns: ["count"],
    });

    await expect(
      applyAlertSpecs({
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
        db,
        resources: [{ path: "missing-column.yaml", resource: alert() }],
      }),
    ).rejects.toThrow(
      /missing-column\.yaml: \$\{service\} references column "service"/,
    );
  });

  it("stores project and the resolved runbook ref on create", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValueOnce({
      rows: [{ service: "api", count: 3 }],
      columns: ["service", "count"],
    });
    mockApplySelect([]);

    await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [
        {
          path: "a.yaml",
          resource: {
            kind: "AlertRule",
            metadata: { name: "shared", project: "platform" },
            spec: {
              evaluationInterval: "5m",
              notificationMessage: { title: "t" },
              query:
                "SELECT service, count() AS count FROM logs GROUP BY service",
              runbook: "db-pool-runbook",
            },
          },
        },
      ],
    });

    const batch = insertValues[0] as Record<string, unknown>[];
    expect(batch[0]).toMatchObject({
      slug: "shared",
      project: "platform",
      runbookProject: "platform",
      runbookSlug: "db-pool-runbook",
    });
  });

  it("keys identity on (project, slug) so the same slug coexists across projects", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValue({
      rows: [],
      columns: ["service", "count"],
    });
    mockApplySelect([]);
    const mk = (project: string) => ({
      kind: "AlertRule",
      metadata: { name: "shared", project },
      spec: {
        evaluationInterval: "5m",
        notificationMessage: { title: "t" },
        query: "SELECT service, count() AS count FROM logs GROUP BY service",
      },
    });

    const result = await applyAlertSpecs({
      namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
      db,
      resources: [
        { path: "a.yaml", resource: mk("platform") },
        { path: "b.yaml", resource: mk("infra") },
      ],
    });

    expect(result.created).toEqual(["shared", "shared"]);
    const batch = insertValues[0] as Record<string, unknown>[];
    expect(batch.map((r) => r.project).sort()).toEqual(["infra", "platform"]);
  });

  it("wraps query errors as apply validation errors with path context", async () => {
    mockedQuerySqlApiWithMeta.mockRejectedValueOnce(new Error("syntax error"));

    try {
      await applyAlertSpecs({
        namespace: { orgId: "org-1", repoid: "repo-1", kind: "live" },
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
